# API (Cloudflare Worker)

API v1 de Gastos de Viaje: única vía de escritura (Constitution III). Contrato:
`specs/001-finance-engine-trips/contracts/http-api.md`.

## Desarrollo local

```bash
pnpm emulators                 # en la raíz: Auth :9099 + Firestore :8080 (requiere Java 21)
cp .dev.vars.example .dev.vars
pnpm dev                       # http://localhost:8787/v1
pnpm test                      # tests en workerd contra el emulador (emuladores encendidos)
```

El modo emulador (tokens sin firma, Firestore local) solo se activa con `ENVIRONMENT=emulator`
**y** un proyecto `demo-*`.

## Despliegue (sin tarjeta)

### 1. Firebase (plan Spark)

1. Crear el proyecto en <https://console.firebase.google.com> (plan Spark, gratuito).
2. **Authentication → Sign-in method**: habilitar **Google**. En *Settings → Authorized domains* añadir el dominio
   de Hosting (`<proyecto>.web.app`) y el de desarrollo si aplica.
3. **Firestore Database**: crear la base de datos en modo producción (región cercana a los usuarios).
4. Desplegar reglas e índices desde la raíz del repo:
   ```bash
   firebase use --add <proyecto>
   firebase deploy --only firestore:rules,firestore:indexes
   ```
5. **Service account** para la API: *Project settings → Service accounts → Generate new private key*.
   Guardar el JSON fuera del repositorio; solo se usa para el paso 2.3.

### 2. Cloudflare Workers (plan Free)

1. `pnpm exec wrangler login`
2. En `wrangler.jsonc` sustituir `FIREBASE_PROJECT_ID` y `ALLOWED_ORIGINS` (dominio de Hosting).
3. Cargar el secreto (pegar el JSON completo de la service account):
   ```bash
   pnpm exec wrangler secret put FIREBASE_SERVICE_ACCOUNT
   ```
4. `pnpm deploy` → anotar la URL `https://gastos-viaje-api.<subdominio>.workers.dev`.

### 3. Web (Firebase Hosting)

```bash
# apps/web/.env.production: VITE_FIREBASE_* del proyecto, VITE_API_URL=<url del worker>/v1, VITE_USE_EMULATORS=false
pnpm --filter web build
firebase deploy --only hosting
```

## Presupuesto del plan Free

- Workers: 100.000 requests/día, **10 ms de CPU por request**. El token OAuth de la service account se cachea
  por isolate y los saldos se leen de una proyección incremental (sin recorrer gastos).
- Firestore Spark: 50.000 lecturas / 20.000 escrituras al día (estimación por operación en `research.md` R12).
