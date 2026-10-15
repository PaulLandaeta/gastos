# Despliegue a producción

Todo funciona sin tarjeta de crédito salvo la IA: Firebase Spark, Cloudflare Workers Free, Backblaze B2 y GitHub Actions
(repositorio público). El escaneo usa la API de OpenAI con crédito prepagado; Gemini en su nivel gratuito queda como
alternativa (`AI_PROVIDER=gemini`).

Hay un solo entorno de producción. Para desarrollo y pruebas se usan los emuladores locales.

## Alta inicial (una vez)

### 1. Firebase (Spark)

1. Crea el proyecto en <https://console.firebase.google.com> sin activar Blaze.
2. Habilita **Authentication → Google**. En *Authorized domains* añade `<proyecto>.web.app`.
3. Crea **Firestore Database** en modo producción, en una región cercana a los usuarios.
4. Registra una **app web** y copia su configuración SDK en `apps/web/.env.production`. Parte de
   `apps/web/.env.production.example`; ese archivo no se versiona.
   - En `VITE_FIREBASE_AUTH_DOMAIN` pon `<proyecto>.web.app`, no el `<proyecto>.firebaseapp.com` que propone la
     consola. Con el dominio de Firebase, Safari en iPhone bloquea el resultado del login al volver de Google y la app
     instalada se queda en la pantalla de inicio de sesión.
   - Para que Google acepte ese dominio, en Google Cloud Console → *APIs y servicios → Credenciales* → *Web client
     (auto created by Google Service)* añade `https://<proyecto>.web.app/__/auth/handler` a *URIs de redirección
     autorizados*. Hazlo **antes** de desplegar: sin esa URI el login falla para todos con `redirect_uri_mismatch`.
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
   - `OPENAI_MODEL` (por defecto `gpt-4.1-mini`), o `AI_PROVIDER=gemini` y `GEMINI_MODEL`;
   - las variables `B2_*`.
3. Carga los secretos, que nunca van en el repositorio:
   El prompt `!` de Claude Code no es interactivo: copia el valor y usa
   `pbpaste | pnpm exec wrangler secret put NOMBRE --env=""`.

   ```bash
   cd apps/api
   pnpm exec wrangler secret put FIREBASE_SERVICE_ACCOUNT   # JSON completo
   pnpm exec wrangler secret put OPENAI_API_KEY             # o GEMINI_API_KEY con AI_PROVIDER=gemini
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

### 4. IA (OpenAI)

1. Crea una clave de proyecto en <https://platform.openai.com/api-keys> con crédito prepagado y, si quieres, un límite
   de gasto mensual en *Limits*.
2. Cárgala como `OPENAI_API_KEY`.

Las cuotas de la app (`AI_QUOTA_*`) limitan los escaneos por viaje, día y mes. OpenAI no entrena con los datos de la API
y los conserva hasta 30 días para detectar abusos; la pantalla de consentimiento de escaneo lo indica.

**Alternativa gratuita:** `AI_PROVIDER=gemini`, `GEMINI_MODEL` y el secreto `GEMINI_API_KEY` (Google AI Studio). En su
nivel gratuito Google puede usar el contenido para mejorar sus productos; actualiza el texto del consentimiento si
vuelves a él.

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
