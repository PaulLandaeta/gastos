# Implementation Plan: Hardening y piloto (Fase 6)

**Branch**: `006-hardening-pilot` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-hardening-pilot/spec.md`

## Summary

La Fase 6 deja el MVP listo para un piloto real:

- **Baja y anonimización (RF-56)**. La API orquesta una baja idempotente y reanudable, con una transacción por viaje y
  un registro `accountDeletions/{uid}`.
  - El miembro conserva su uid opaco y pasa a ser «Participante eliminado N». Los saldos son idénticos por
    construcción.
  - Se borran el perfil, la cuenta de Auth, las notificaciones, las invitaciones recibidas, los borradores y los
    comprobantes de gastos personales.
  - El rol de creador se traspasa automáticamente.
  - Los gestores pueden registrar o confirmar pagos en lugar del eliminado.
- **Despliegue reproducible**. Una herramienta `apps/ops` (Node) hace `preflight` y `smoke`.
  - `pnpm deploy:prod` publica Hosting, Rules, índices y Worker, versionados con el sha de git.
  - Incluye un workflow manual de despliegue y un runbook con la vuelta atrás.
- **Backups**. Un workflow diario de GitHub Actions exporta Firestore por REST, cifra el resultado (gzip + AES-GCM) y lo
  guarda en un bucket B2 privado aparte, con retención 7 + 4.
  - La restauración se prueba en CI contra el emulador y reaplica las bajas.
- **Monitoreo**. Health con versión y prueba de Firestore, log estructurado por petición y uptime cada 15 min (GitHub
  Actions, que avisa por correo al fallar).
  - El documento de costos y límites se acompaña de un runbook.
- **Hardening**:
  - CSP generada en el build y cabeceras de Hosting;
  - rate limiting con el binding de Workers;
  - mapeo de cuota agotada a 503;
  - axe ampliado y Lighthouse en CI;
  - revisión de seguridad documentada.
- **Piloto**: lista de lanzamiento (PRD §15 → evidencia) y guía de pruebas con usuarios.

## Technical Context

**Language/Version**: TypeScript 6, Node ≥ 24 (herramienta `ops`), Workers (API).

**Primary Dependencies**:
- `apps/ops`: `tsx` para ejecutar TypeScript y `aws4fetch` (ya usado en la API) para S3/B2. Usa `node:zlib` y
  `node:crypto` y reutiliza el cliente Firestore y la anonimización de `apps/api/src` mediante importación relativa.
- CI: `lighthouse` (devDependency de web, solo en un job de CI).
- Sin dependencias nuevas en web ni en la API.

**Storage**:
- Firestore:
  - `accountDeletions/{uid}` (registro de bajas, sin PII);
  - en los miembros, `deletedAt` y `deletedOrdinal`;
  - en el viaje, `deletedMemberCount`;
  - en `firestore.indexes.json`, los índices de collection group `notifications.actorUid` y `members.uid`.
- B2: bucket nuevo `…-backups` (privado), separado del de comprobantes.

**Testing**:
- **API (workerd + emulador)**:
  - baja completa con un viaje de 3 personas: gastos, ítems, pago confirmado y devolución. Los saldos son iguales antes
    y después (SC-001) y la búsqueda exhaustiva del nombre y el correo da 0 apariciones (SC-002);
  - bloqueo por pagos pendientes, traspaso de creador, reanudación tras un fallo inyectado e idempotencia;
  - pagos gestionados con un eliminado;
  - `REAUTH_REQUIRED`;
  - cuenta eliminada no puede volver a sincronizar ni crear viajes;
  - el cron completa bajas en curso;
  - health, log por petición sin PII (SC-009), limitador con binding falso y `RESOURCE_EXHAUSTED` → 503.
- **Rules**: un miembro eliminado no puede leer; los negativos de siempre.
- **Ops (Vitest en Node contra el emulador)**:
  - ida y vuelta de cifrado;
  - selección de la poda;
  - `preflight` con configuraciones incompletas;
  - simulacro de restauración: sembrar con la API, hacer backup a un directorio, vaciar, restaurar y comparar
    documentos y saldos (SC-005); la completitud se valida con `listCollectionIds`;
  - `reconcileDeletions` reaplica una baja posterior a la copia.
- **Web (Vitest)**: modelo de la pantalla de baja y mapeo de errores `RATE_LIMITED`/`SERVICE_UNAVAILABLE`.
- **E2E (Playwright)**:
  - baja de Pedro de punta a punta: se ve la etiqueta y el gestor confirma el pago;
  - axe en las pantallas nuevas;
  - la CSP no rompe la app (proyecto `pwa`, build real);
  - `smoke` contra el stack local.

**Target Platform**: igual que la Fase 5. Operación desde macOS/Linux con Node 24.

**Performance Goals**:
- baja de 10 viajes en menos de 1 min (SC-003);
- CPU del Worker por viaje anonimizado en menos de 10 ms (`perf`);
- despliegue en menos de 15 min (SC-004);
- restauración en menos de 1 h (SC-005).

**Constraints**:
- Solo servicios sin tarjeta.
- Los backups nunca en el mismo almacenamiento que Firestore ni en el bucket de comprobantes.
- Logs públicos de Actions sin PII ni secretos.

**Scale/Scope**: piloto de unos 20 usuarios y 10 viajes activos.

## Constitution Check

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | La anonimización no toca gastos, pagos, devoluciones ni el libro mayor (el uid opaco se conserva). Hay un test de saldos idénticos y Σ = 0. Los pagos gestionados usan el mismo `paymentEffect`. | ✅ |
| II. Privacidad | La baja borra la PII (R4). Rules y API excluyen a los eliminados y los logs no llevan PII (test). La CSP y las cabeceras se refuerzan. Los backups van cifrados a un bucket privado aparte. | ✅ |
| III. Escrituras en servidor | La baja y los pagos gestionados solo por API. El cliente no escribe. | ✅ |
| IV. Auditable / idempotente | El registro `accountDeletions` permite reanudar. Auditoría `member.deleted` y `member.creator_transferred` sin PII. Los pagos gestionados registran al gestor en `resolvedBy`/`createdBy`. | ✅ |
| V. Test-first | Primero los tests de baja, Rules, ops y E2E. El simulacro de restauración corre en CI. | ✅ |
| VI. Free tier | Presupuesto en R13 (< 50 %). GitHub Actions gratis (repo público), B2 en su plan gratuito y el binding de rate limit de Workers en el plan Free. | ✅ |
| VII. PWA accesible | axe en las pantallas nuevas y Lighthouse en CI. La CSP se prueba sobre el build con el service worker. | ✅ |
| VIII. Simplicidad | Sin entorno de staging ni servicio de guardia. La herramienta `ops` es mínima y reutiliza código de la API. | ✅ (ver Complexity Tracking) |

**Re-check post-diseño**: ✅.

## Project Structure

### Documentation (this feature)

```text
specs/006-hardening-pilot/
├── plan.md · research.md · data-model.md · quickstart.md
└── contracts/ http-api.md · access-rules.md · ops-cli.md
docs/
├── deploy.md            # despliegue, secretos, vuelta atrás
├── operations.md        # monitoreo, alertas, backups/restauración, costos y límites (R13)
├── security-review.md   # revisión FR-030
├── launch-checklist.md  # PRD §15 → evidencia
└── pilot-guide.md       # guía de pruebas con usuarios
```

### Source Code

```text
packages/contracts/src/
├── errors.ts            # + ACCOUNT_DELETION_BLOCKED, REAUTH_REQUIRED, ACCOUNT_DELETED, RATE_LIMITED, SERVICE_UNAVAILABLE
├── api/account.ts       # DeletionPreview, DeleteAccountBody, DeleteAccountResponse
├── api/settlements.ts   # + fromUid opcional
└── domain.ts            # Member + deletedAt/deletedOrdinal; Trip + deletedMemberCount

apps/api/src/
├── auth/verifyIdToken.ts       # + authTime
├── auth/identityToolkit.ts     # deleteAuthUser, lookupAuthUsers (REST; emulador)
├── firestore/token.ts          # scope + identitytoolkit
├── services/accountDeletion.ts # previewDeletion, deleteAccount, anonymizeInTrip, finishDeletion, reconcileDeletions
├── services/tripRepo.ts        # isDeleted, activeUids; loadTripForMember rechaza eliminados
├── services/settlements.ts     # pagos gestionados con eliminados
├── services/notifications.ts   # excluir eliminados
├── services/users.ts · trips.ts · invitations.ts # bloquear cuentas eliminadas
├── services/retention.ts       # + continuar bajas en curso (cron)
├── http/rateLimit.ts · http/requestLog.ts
├── routes/account.ts           # GET /v1/me/deletion-preview, POST /v1/me/deletion
└── index.ts                    # health ampliado, middlewares, mapeo RESOURCE_EXHAUSTED

apps/ops/                        # NUEVO: CLI de operación (Node 24 + tsx)
├── src/cli.ts                   # preflight | smoke | backup | restore | prune | reconcile
├── src/backup.ts · restore.ts · crypto.ts · retention.ts · s3.ts · preflight.ts · smoke.ts · collections.ts
└── tests/                       # Vitest en Node contra emulador

apps/web/src/
├── features/account/AccountPage.tsx · DeleteAccountPage.tsx · deletionModel.ts
├── features/settlements/        # registrar/confirmar en nombre de un eliminado
├── lib/apiClient.ts             # RATE_LIMITED / SERVICE_UNAVAILABLE / ACCOUNT_DELETED
├── app/router.tsx               # rutas con carga diferida + prefetchRoutes (rendimiento, offline)
├── zodConfig.ts                 # Zod jitless (CSP sin unsafe-eval)
config/csp.ts                    # plugins de Vite: CSP (meta) y /version.json

firebase/firestore.rules · firestore.indexes.json · firebase.json (cabeceras)
.github/workflows/ ci.yml (+ ops, lighthouse) · backup.yml · uptime.yml · deploy.yml
```

**Structure Decision**: mismo monorepo; nuevo `apps/ops` para la operación en Node (backups, despliegue y smoke).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Nuevo workspace `apps/ops` (Node) | Backups, restauración, preflight y smoke necesitan Node sin el límite de CPU del Worker y fuera del navegador. | Hacerlo en el cron del Worker no alcanza con 10 ms de CPU; los scripts sueltos no tendrían tests ni tipos. |
| `ops` importa código de `apps/api/src` por ruta relativa | Reaplicar bajas tras una restauración debe usar exactamente la misma anonimización. | Duplicar la lógica en `ops` arriesga divergencias; extraerla a un paquete aparte supone más estructura para un solo consumidor. |
| GitHub Actions como planificador de backups y uptime | Gratis e ilimitado en repositorio público, con correo al fallar. | Firebase no ofrece backups en Spark; otros servicios de monitoreo exigen alta adicional (UptimeRobot queda como alternativa documentada). |
