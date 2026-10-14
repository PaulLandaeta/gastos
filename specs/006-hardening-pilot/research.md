# Research: Hardening y piloto (Fase 6)

## R1 — Orquestación de la baja (RF-56)

**Decision**: la API orquesta la baja en pasos idempotentes, registrados en `accountDeletions/{uid}`:

1. `POST /v1/me/deletion` valida la confirmación, el inicio de sesión reciente y que no haya pagos pendientes. Crea el
   registro (`status: in_progress`, `tripIds` pendientes) **antes** de tocar nada.
2. Procesa cada viaje en **una transacción por viaje**:
   - anonimiza el miembro y traspasa el rol de creador;
   - reindexa a los demás y escribe la auditoría;
   - borra el índice `users/{uid}/trips/{tripId}`.
3. Fuera de transacción ejecuta las limpiezas idempotentes: comprobantes privados y borradores, notificaciones propias,
   nombres en notificaciones ajenas, invitaciones recibidas y perfil.
4. Borra la cuenta de Firebase Auth con Identity Toolkit REST (`accounts:delete`; scope `identitytoolkit` añadido al
   token de la service account). El emulador acepta `Bearer owner`.
5. Marca `status: completed`.

Si algo falla, la siguiente llamada o el cron horario existente continúa desde el último viaje pendiente (FR-010).

**Rationale**:
- Una transacción por viaje mantiene cada viaje coherente: nunca queda un viaje a medias, como pide el edge case.
- Además respeta el límite de 500 escrituras por commit y los ~10 ms de CPU del Worker por invocación: cada viaje
  cuesta poco CPU y el resto es E/S.

**Alternatives**:
- Una sola transacción global: supera los límites con 10 viajes.
- Hacer la baja en un job asíncrono únicamente: la UX esperaría al cron (hasta 1 h).

## R2 — Inicio de sesión reciente

**Decision**: `verifyIdToken` expone `authTime`. La baja exige `now − auth_time ≤ 300 s`; si no, responde
`REAUTH_REQUIRED`. El cliente llama a `reauthenticateWithPopup(GoogleAuthProvider)`, fuerza el refresco del token y
reintenta.

**Rationale**: es el patrón estándar de Firebase para operaciones sensibles y no necesita estado en el servidor.

## R3 — Representación del participante eliminado

**Decision**: el documento `trips/{t}/members/{uid}` se conserva con la misma clave y cambia así:
- `displayName: "Participante eliminado N"`, `email: ""`.
- Campos nuevos: `deletedAt` y `deletedOrdinal: N`. N sale de `trip.deletedMemberCount + 1`.

El uid se mantiene como identificador opaco en gastos, pagos, devoluciones y libro mayor, así que los saldos no se
recalculan y son idénticos por construcción (SC-001).

Ajustes en el resto del sistema:
- **Rules**: `isMember` exige además `deletedAt == null`.
- **API**: `loadTripForMember` rechaza a un `me` eliminado.
- **Notificaciones**: excluyen a los eliminados (helper `activeUids`).
- **Exportaciones y UI**: muestran la etiqueta, porque ya usan `displayName`.

**Rationale**:
- Firebase asigna un uid nuevo si la misma cuenta de Google vuelve (FR-012).
- Sin cuenta de Auth ni perfil, el uid no identifica a nadie.
- Reescribir el uid en todo el historial costaría miles de escrituras y pondría en riesgo los invariantes.

**Alternatives**: seudónimo nuevo (`anon_<rand>`) reescrito en todos los documentos. Se rechaza por su coste y su
riesgo.

## R4 — Política de comprobantes (PRD #2) y otros datos personales

| Dato | Acción |
|---|---|
| `users/{uid}`, `users/{uid}/trips/*`, `users/{uid}/notifications/*` | Borrar. |
| Cuenta de Firebase Auth | Borrar. |
| Invitaciones recibidas pendientes (`invitations/{email}/trips/*` y fila `inv_*`) | Borrar (como rechazadas). |
| Adjuntos de gastos personales (todos los pagadores y todos los cargados = solo él) | Borrar objeto y marcar `deletedAt` (función de borrado de la retención). |
| `uploads` y `scans` del usuario | Borrar documento y objeto. |
| Adjuntos de gastos compartidos y de pagos | Conservar hasta el vencimiento de 6 meses. `uploadedBy` es el uid opaco. |
| Notificaciones de otros con `actorUid == uid` | Reemplazar en `title` los nombres anteriores por la etiqueta. Índice de collection group `notifications.actorUid`. |
| Índices de invitación enviadas (`inviterDisplayName`) | Se regeneran con `syncIndexes`, con el nombre del nuevo creador. |
| Auditoría | Ya enmascara correos (`a***@dominio`); no guarda nombres. Se añade `member.deleted` sin PII. |
| Descripciones y notas libres | Se conservan: son registros financieros compartidos (Assumptions). |

## R5 — Pagos con un participante eliminado (FR-009)

**Decision**:
- `POST /settlements` acepta `fromUid` opcional. Si es distinto del actor, este debe ser `creator`/`admin` y `fromUid`
  un participante eliminado: un gestor registra un pago **del** eliminado.
- `confirm` y `reject`: si el receptor está eliminado, puede resolver un gestor.
- `cancel`: si el emisor está eliminado, puede cancelar un gestor.
- La inmutabilidad y el efecto en el libro mayor no cambian.

## R6 — Copias de seguridad sin Blaze

**Decision**: un workflow de GitHub Actions programado a diario (el repositorio es público, así que los minutos son
gratis) ejecuta `apps/ops` en Node 24 con `tsx`. El proceso:

1. **Exporta** con Firestore REST usando la service account. Hace un `runQuery` de collection group por cada id de
   colección conocido (`allDescendants`, orden por `__name__`, páginas de 500). Comprueba la completitud comparando con
   `listCollectionIds` recursivo en el test de restauración.
2. **Guarda** NDJSON con `{name, fields}` en codificación REST cruda, sin pérdida de tipos.
3. **Cifra**: gzip y luego AES-256-GCM con la clave `BACKUP_KEY` (32 bytes en base64). El formato es `GVB1‖iv‖tag‖ct`
   y lleva un manifiesto en claro sin PII: fecha, recuentos y sha256.
4. **Sube** con S3 SigV4 (`aws4fetch`) a un **bucket B2 privado distinto** del de comprobantes.
5. **Poda**: conserva las 7 copias diarias más recientes y las de domingo de las últimas 4 semanas. La selección es
   una función pura testeada.

**Restauración** (`ops restore`): descifra, verifica el sha256 y escribe por lotes de 500 con `commit`. Después ejecuta
`reconcileDeletions` sobre la unión de tres fuentes:
- el registro `accountDeletions` restaurado;
- el registro de la base viva, si existe;
- los uids con perfil o membresía cuya cuenta de Auth ya no existe (`accounts:lookup`).

Auth no se pierde con Firestore, así que la tercera fuente cubre las bajas posteriores a la copia (FR-020).

**Coste**: una lectura por documento al día. En el piloto (~5.000 documentos) es el 10 % del límite de 50.000
lecturas.

**Alternatives**:
- Export gestionado (`gcloud firestore export`): requiere Blaze.
- Hacer la copia en el cron del Worker: 10 ms de CPU no alcanzan para serializar miles de documentos.

## R7 — Monitoreo y alertas gratuitas

**Decisión**:

- **Health (`GET /v1/health`)**: devuelve `{ ok, version, environment, firestore }`. La comprobación de Firestore lee
  el documento inexistente `ops/health` (1 lectura) y solo se hace con `?deep=1`. `API_VERSION` es la variable que
  inyecta el despliegue: `--var API_VERSION:<sha>`.
- **Uptime (`.github/workflows/uptime.yml`)**: corre cada 15 minutos y ejecuta `ops smoke --light`, que comprueba el
  health con `deep` y que la app cargue.
  - Si el workflow falla, GitHub envía un correo al responsable (FR-023, SC-006).
  - Inconveniente: GitHub desactiva los crons de repositorios sin actividad durante 60 días. Está documentado en el
    runbook.
  - Alternativa documentada: UptimeRobot en su plan gratuito.
- **Logs**: un middleware añade una línea `request` por petición con `correlationId`, `route` (patrón de Hono,
  `c.req.routePath`, sin ids), `method`, `status`, `code` y `ms`. Se ven en Workers Observability, que ya está activado.
- **Cuota agotada**: el error `RESOURCE_EXHAUSTED` de Firestore se traduce a `SERVICE_UNAVAILABLE` (503, `retryAfter`).
  La web muestra «Servicio temporalmente no disponible» (FR-031).

## R8 — Rate limiting

**Decision**: binding `ratelimits` de Workers (disponible en el plan Free):
- `USER_LIMITER`: 120 peticiones cada 60 s, con clave `uid`.
- `IP_LIMITER`: 60 peticiones cada 60 s, con clave `cf-connecting-ip`, para las rutas públicas.

Si se supera, responde `RATE_LIMITED` (429, `Retry-After: 60`).

En el emulador y en los tests no hay binding, así que el middleware no actúa; su lógica se prueba con un limitador
falso. Los límites son por colo y aproximados, que basta para frenar ráfagas.

**Alternatives**: contadores en Firestore. Se descarta porque consumiría escrituras en cada petición.

## R9 — CSP y cabeceras

**Decisión**:

- **CSP como `<meta http-equiv>` generada en el build** por un plugin de Vite a partir de las variables `VITE_*`:
  - Valor: `default-src 'self'`; `script-src 'self' https://apis.google.com`; `connect-src` con la API, Firestore,
    Identity Toolkit, securetoken, B2 y, en modo emulador, los hosts locales; `img-src 'self' data: blob:`, B2 y
    `lh3.googleusercontent.com`; `frame-src` con `<authDomain>` y `accounts.google.com`; `worker-src 'self'`;
    `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`.
  - Así la CSP se prueba en E2E sobre `vite preview` con la app real.
- **Cabeceras estáticas en `firebase.json`**:
  - `Strict-Transport-Security`;
  - `X-Frame-Options: DENY` (`frame-ancestors` no funciona en una meta);
  - `Permissions-Policy` (cámara solo `self`);
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`, para el popup de Google;
  - `Cache-Control` sin caché para `index.html` y `sw.js`.
- **API**: además, `X-Content-Type-Options: nosniff` y `Cache-Control: no-store` por defecto.

## R10 — Despliegue reproducible

**Decision**: `apps/ops` incluye los comandos `preflight`, `smoke` y `backup`/`restore`/`prune`/`reconcile`.

- **`preflight`** comprueba:
  - que no queda ningún `REPLACE_WITH` en `wrangler.jsonc` ni en `.env.production`;
  - que existen las variables `VITE_*`;
  - los secretos (`wrangler secret list --format json`);
  - el proyecto de Firebase.

  Si falla, termina con código ≠ 0 y una lista de lo que falta.
- **`pnpm deploy:prod`** ejecuta, en orden:
  1. `preflight`;
  2. el build de la web con `VITE_APP_VERSION=<sha>`, que genera `/version.json`;
  3. `firebase deploy --only firestore:rules,firestore:indexes,hosting`;
  4. `wrangler deploy --var API_VERSION:<sha>`;
  5. `smoke`.
- **`smoke`** comprueba:
  - que la app carga con la CSP y las cabeceras;
  - que `version.json` coincide con `health.version`;
  - que el health responde `deep` ok;
  - el CORS: origen de la app permitido y `https://evil.example` rechazado;
  - que `/v1/trips` sin token responde 401.
- **Vuelta atrás**: `firebase hosting:rollback` y `wrangler rollback`. Están en el runbook.
- **Workflow manual** `deploy.yml` (`workflow_dispatch`) con secretos de repositorio: `GCP_SA_KEY` y
  `CLOUDFLARE_API_TOKEN`.

## R11 — Lighthouse y accesibilidad

**Decision**:
- **Accesibilidad**: se amplía `a11y.spec.ts` (axe, WCAG 2.1 AA) a las pantallas de 005 y 006: cuenta, baja,
  notificaciones, pendientes y pagos con un participante eliminado.
- **Lighthouse**: Lighthouse 12 eliminó la categoría PWA.
  - **Instalabilidad**: se verifica con el E2E `pwa` existente (manifest y SW, SC-009 de 005).
  - **Resto de categorías**: `lighthouse` se ejecuta en un job de CI sobre `vite preview` (`/login`, emulado en móvil),
    con umbrales: accesibilidad ≥ 0,9, buenas prácticas ≥ 0,9 y rendimiento ≥ 0,8 (SC-007).

## R12 — Revisión de seguridad

**Decision**: se hace una revisión manual guiada, documentada en `docs/security-review.md`. Cubre:
- autenticación y autorización por ruta;
- Rules;
- URLs firmadas;
- exportaciones;
- baja;
- CORS y CSP;
- secretos;
- logs.

Cada hallazgo queda resuelto o aceptado con su justificación (FR-030). Los tests negativos de las Rules se amplían a
los participantes eliminados.

## R13 — Consumo free tier del piloto (20 usuarios, 10 viajes activos)

| Recurso | Límite | Estimado/día | % |
|---|---|---|---|
| Firestore lecturas | 50.000 | ~8.000 (app) + ~5.000 (backup) + 100 (health) | 26 % |
| Firestore escrituras | 20.000 | ~1.500 | 8 % |
| Firestore almacenamiento | 1 GiB | ~50 MB | 5 % |
| Workers requests | 100.000 | ~10.000 | 10 % |
| B2 almacenamiento | 10 GB | comprobantes ~1 GB + backups 11 × ~5 MB | 11 % |
| Gemini | cuota de AI Studio | ≤ 100 escaneos/día (cuota global existente) | — |
| GitHub Actions | ilimitado (público) | uptime 96 + backup 1 ejecuciones | — |

Cumple SC-010 (< 50 % de cada límite).
