# Despliegue a producción

Todo funciona sin tarjeta de crédito: Firebase Spark, Cloudflare Workers Free, Backblaze B2, Gemini (nivel gratuito) y
GitHub Actions (repositorio público).

Hay un solo entorno de producción. Para desarrollo y pruebas se usan los emuladores locales.

## Alta inicial (una vez)

### 1. Firebase (Spark)

1. Crea el proyecto en <https://console.firebase.google.com> sin activar Blaze.
2. Habilita **Authentication → Google**. En *Authorized domains* añade `<proyecto>.web.app`.
3. Crea **Firestore Database** en modo producción, en una región cercana a los usuarios.
4. Registra una **app web** y copia su configuración SDK en `apps/web/.env.production`. Parte de
   `apps/web/.env.production.example`; ese archivo no se versiona.
5. Crea la **service account de la API** en *Project settings → Service accounts → Generate new private key*.
   - Guarda el JSON fuera del repositorio.
   - Para los backups crea otra cuenta con rol de **solo lectura** de Datastore, *Cloud Datastore Viewer*, desde
     IAM de Google Cloud. La consola de IAM no exige facturación.
6. En `.firebaserc`, sustituye `REPLACE_WITH_PROJECT_ID` del alias `prod`.

### 2. Cloudflare Workers (Free)

1. Ejecuta `pnpm --filter api exec wrangler login`.
2. Rellena los `REPLACE_WITH_*` de `apps/api/wrangler.jsonc`, sección superior, que es la de producción:
   - `FIREBASE_PROJECT_ID`;
   - `ALLOWED_ORIGINS`, con `https://<proyecto>.web.app`;
   - `GEMINI_MODEL`;
   - las variables `B2_*`.
3. Carga los secretos, que nunca van en el repositorio:
   ```bash
   cd apps/api
   pnpm exec wrangler secret put FIREBASE_SERVICE_ACCOUNT   # JSON completo
   pnpm exec wrangler secret put GEMINI_API_KEY
   pnpm exec wrangler secret put B2_KEY_ID
   pnpm exec wrangler secret put B2_APPLICATION_KEY
   ```
4. El rate limiting ya está declarado en `ratelimits` (120 peticiones por minuto y usuario, 60 por minuto e IP en
   rutas públicas) y funciona en el plan Free.

### 3. Backblaze B2 (dos buckets privados)

| Bucket | Uso | Clave |
|---|---|---|
| `…-receipts` | Comprobantes (feature 004) | Lectura y escritura solo de ese bucket. Secretos del Worker. |
| `…-backups` | Copias de Firestore (feature 006) | Lectura y escritura solo de ese bucket. Secretos de GitHub. |

- En el bucket de comprobantes, configura CORS: origen `https://<proyecto>.web.app`, métodos `PUT, GET` y cabecera
  `content-type`.
- En el bucket de backups no configures CORS ni acceso público.

### 4. Gemini

Crea una clave en Google AI Studio y cárgala como `GEMINI_API_KEY`.

> **Aviso de privacidad (riesgo aceptado para el piloto):** en el nivel gratuito, Google puede usar el contenido
> enviado para mejorar sus productos. La pantalla de consentimiento de escaneo lo indica (feature 004).

## Desplegar

```bash
pnpm --filter ops ops preflight   # se detiene si queda algún REPLACE_WITH, falta un secreto o una variable
pnpm deploy:prod                  # preflight → build → reglas e índices → Worker → Hosting → smoke test
```

`scripts/deploy.sh`:
- se niega a desplegar con cambios sin confirmar;
- versiona la app (`/version.json`) y la API (`health.version`) con el sha de git;
- al final ejecuta `ops smoke`, que comprueba la carga de la app, la CSP, las cabeceras, la versión, Firestore, el
  CORS y la autenticación.

### Desde GitHub (opcional)

El workflow **Deploy** (`.github/workflows/deploy.yml`, ejecución manual) hace lo mismo.

| Tipo | Nombre |
|---|---|
| Secretos | `GCP_SA_KEY` (cuenta con rol *Firebase Admin*), `CLOUDFLARE_API_TOKEN` |
| Variables | `CLOUDFLARE_ACCOUNT_ID`, `APP_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_API_URL`, `VITE_RECEIPTS_ORIGIN` |

## Vuelta atrás

1. **Web**: `npx firebase-tools hosting:rollback --project prod`, o desde la consola en *Hosting → Release history →
   Rollback*.
2. **API**: `pnpm --filter api exec wrangler rollback`. Muestra las versiones y vuelve a la anterior.
3. **Reglas**: `git checkout <sha-anterior> -- firebase/firestore.rules`, después
   `npx firebase-tools deploy --project prod --only firestore:rules`.
4. Ejecuta `pnpm --filter ops ops smoke --app <APP_URL> --api <API_URL>`.

   Tras una vuelta atrás parcial, «App y API tienen la misma versión» puede fallar. Es lo esperado mientras ambas no
   coincidan.

Los índices no se borran al volver atrás: los índices de más no afectan.
