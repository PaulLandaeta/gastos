# Tasks: Hardening y piloto (Fase 6)

**Input**: Design documents from `specs/006-hardening-pilot/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obligatorios (constitution, Principio V — test-first). Cada test se escribe antes que su implementación y
debe fallar primero.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1 baja · US2 despliegue · US3 backups · US4 monitoreo · US5 hardening y piloto

---

## Phase 1: Setup

- [X] T001 Crear el workspace apps/ops (package.json con `tsx`, `aws4fetch`, `vitest`; tsconfig.json; vitest.config.ts en Node con `fileParallelism: false`; script `ops` = `tsx src/cli.ts`) y añadirlo al script `test` raíz y a eslint en package.json
- [X] T002 [P] Añadir a packages/contracts/src/errors.ts los códigos `ACCOUNT_DELETION_BLOCKED` (409), `REAUTH_REQUIRED` (401), `ACCOUNT_DELETED` (403), `RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503), con tests en packages/contracts/tests/phase6.test.ts
- [X] T003 [P] Añadir `deletedAt`/`deletedOrdinal` a `Member` y `deletedMemberCount` a `Trip` en packages/contracts/src/domain.ts; crear packages/contracts/src/api/account.ts (`DeletionPreview`, `DeleteAccountBody` literal `BORRAR`, `DeleteAccountResponse`) y `fromUid` opcional en packages/contracts/src/api/settlements.ts, con tests en packages/contracts/tests/phase6.test.ts

---

## Phase 2: Foundational

- [X] T004 Exponer `authTime` en `AuthUser` en apps/api/src/auth/verifyIdToken.ts (test en apps/api/tests/auth/verifyIdToken.test.ts) y permitir `auth_time` configurable en apps/api/tests/helpers/emulator.ts
- [X] T005 [P] Añadir `isDeleted(member)` y `activeUids(members)` en apps/api/src/services/tripRepo.ts; `loadTripForMember` rechaza un `me` eliminado (NOT_FOUND); `toMemberDto` incluye `deletedAt`
- [X] T006 [P] Ampliar el scope del token de service account con `identitytoolkit` en apps/api/src/firestore/token.ts y crear apps/api/src/auth/identityToolkit.ts (`deleteAuthUser(env, uid)` idempotente, `lookupAuthUsers(env, uids)`; emulador `http://<auth host>/identitytoolkit.googleapis.com/v1/projects/<p>/accounts:*` con `Bearer owner`; añadir `FIREBASE_AUTH_EMULATOR_HOST` a env.ts, wrangler.jsonc emulador y vitest.config) con test contra el emulador en apps/api/tests/auth/identityToolkit.test.ts

**Checkpoint**: contratos, autenticación reciente y utilidades de miembros eliminados listas.

---

## Phase 3: User Story 1 — Baja y anonimización (P1) 🎯 MVP

**Goal**: RF-56 con saldos idénticos, sin PII y reanudable.

**Independent Test**: apps/api/tests/routes/account.test.ts (saldos antes = después, búsqueda exhaustiva de PII = 0).

### Tests (primero, deben fallar)

- [X] T007 [P] [US1] Tests de preview y bloqueo en apps/api/tests/routes/account.test.ts: `GET /v1/me/deletion-preview` (saldo por viaje, sucesor, adjuntos a borrar, `blocked`), `POST /v1/me/deletion` con body inválido → VALIDATION_FAILED, `auth_time` de hace 10 min → REAUTH_REQUIRED, pago pendiente (emisor y receptor) → ACCOUNT_DELETION_BLOCKED
- [X] T008 [P] [US1] Test de baja completa en apps/api/tests/routes/account.test.ts: viaje Ana/Pedro/Juan con gasto simple, gasto por ítems, gasto personal con comprobante, gasto compartido con comprobante, pago confirmado y devolución; tras la baja de Pedro: saldos idénticos y Σ=0, miembro «Participante eliminado 1» con email vacío, `users/uid-pedro/**` inexistente, cuenta de Auth borrada, adjunto personal borrado (objeto y doc), adjunto compartido conservado, notificaciones de Ana sin «Pedro», invitaciones pendientes a pedro@ borradas, auditoría `member.deleted`; búsqueda en todos los documentos del emulador sin «Pedro» ni «pedro@example.com» (SC-002)
- [X] T009 [P] [US1] Tests de traspaso y casos límite en apps/api/tests/routes/account.test.ts: creador con admin → el admin pasa a creador (y `users/{admin}/trips` con role creator); creador sin admin → participante más antiguo; único miembro → conserva rol; dos eliminados → etiquetas 1 y 2; viaje cerrado y archivado se anonimiza
- [X] T010 [P] [US1] Tests de idempotencia y reanudación en apps/api/tests/routes/account.test.ts: fallo inyectado tras el primer viaje (`accountDeletion.failAfterTrips` de test) → `in_progress`; segunda llamada completa sin duplicar etiquetas; el cron (`runRetention`) completa bajas `in_progress`; cuenta eliminada → `me/sync`, crear viaje y aceptar invitación responden ACCOUNT_DELETED
- [X] T011 [P] [US1] Tests de pagos gestionados en apps/api/tests/routes/settlements.test.ts: Juan registra pago a eliminado y Ana (creadora) lo confirma; Ana registra pago en nombre del eliminado (`fromUid`) y Juan lo confirma; un miembro normal no puede usar `fromUid`; `fromUid` de un miembro activo → FORBIDDEN; ningún doc creado bajo `users/<eliminado>`
- [X] T012 [P] [US1] Tests de Rules en firebase/tests/phase6.rules.test.ts: miembro con `deletedAt` no lee trip, members, expenses, settlements, categories; nadie lee `accountDeletions/*` ni `ops/*`

### Implementación

- [X] T013 [US1] Implementar apps/api/src/services/accountDeletion.ts: `previewDeletion`, `deleteAccount` (validaciones, registro, bucle por viaje), `anonymizeInTrip` (transacción: etiqueta con `deletedMemberCount`, traspaso de creador, `syncIndexes`, borrar índice propio, auditoría), limpiezas idempotentes (adjuntos personales + uploads/scans con la función de borrado de retención, notificaciones propias, `title` de notificaciones ajenas por collection group `actorUid`, invitaciones recibidas con su fila `inv_*`, perfil), `deleteAuthUser`, `completed`; `resumeDeletions(db, storage, env, now)` para el cron
- [X] T014 [US1] Crear apps/api/src/routes/account.ts (`GET /v1/me/deletion-preview`, `POST /v1/me/deletion`) y registrarla en apps/api/src/routes/index.ts
- [X] T015 [US1] Bloquear cuentas eliminadas (`accountDeletions/{uid}` existe → ACCOUNT_DELETED) en apps/api/src/services/users.ts (`syncProfile`), apps/api/src/services/trips.ts (crear viaje) y apps/api/src/services/invitations.ts (aceptar)
- [X] T016 [US1] Excluir eliminados de las notificaciones: `writeNotifications(tx, drafts, now, members?)` filtra destinatarios eliminados en apps/api/src/services/notifications.ts y pasar `loaded.members` en todas las llamadas (expenses, settlements, refunds, tripStatus, invitations, trips)
- [X] T017 [US1] Pagos gestionados en apps/api/src/services/settlements.ts y apps/api/src/routes/settlements.ts (`fromUid`, resolución/cancelación por gestor cuando la otra parte está eliminada, `createdBy`, `onBehalfOf` en auditoría)
- [X] T018 [US1] Llamar a `resumeDeletions` desde `runRetention` (o el `scheduled`) en apps/api/src/services/retention.ts / apps/api/src/index.ts
- [X] T019 [US1] Rules: `isMember` exige `deletedAt == null` en firebase/firestore.rules; índices de collection group `notifications.actorUid` y `members.uid` (reconciliación) en firebase/firestore.indexes.json (uploads/scans se consultan por viaje: sin índice)
- [X] T020 [P] [US1] Web: apps/web/src/features/account/deletionModel.ts (texto de consecuencias, validación de «BORRAR») con test en apps/web/tests/unit/deletionModel.test.ts
- [X] T021 [US1] Web: apps/web/src/features/account/DeleteAccountPage.tsx (`/account/delete`: resumen por viaje, bloqueos con enlace al pago, aviso de pendientes offline, campo de confirmación, reautenticación con `reauthenticateWithPopup` ante REAUTH_REQUIRED, al completar `clearLocalData()` + `signOut` + pantalla «Cuenta eliminada»); enlace «Borrar mi cuenta» en apps/web/src/features/auth/AccountMenu.tsx; ruta en apps/web/src/app/router.tsx
- [X] T022 [US1] Web: mostrar «Participante eliminado N» sin avatar ni correo en miembros/saldos; en apps/web/src/features/settlements/ permitir a gestores «Registrar pago de …» en nombre de un eliminado y confirmar/rechazar pagos cuyo receptor está eliminado
- [X] T023 [US1] Web: ante ACCOUNT_DELETED o fallo de refresco por usuario inexistente, borrar datos locales y cerrar sesión en apps/web/src/features/auth/AuthProvider.tsx
- [X] T024 [US1] E2E apps/web/tests/e2e/account-deletion.spec.ts: recorrido 1–6 del quickstart (bloqueo, baja, etiqueta, saldos iguales, pago gestionado, reingreso como usuario nuevo)

**Checkpoint**: RF-56 completo y verificable.

---

## Phase 4: User Story 2 — Despliegue reproducible (P1)

**Goal**: publicar con un comando, detectando configuraciones incompletas y verificando después.

**Independent Test**: apps/ops/tests/preflight.test.ts y `smoke` contra el stack local.

- [X] T025 [P] [US2] Tests de `preflight` en apps/ops/tests/preflight.test.ts (fixtures: `REPLACE_WITH` en wrangler, falta `VITE_API_URL`, secreto ausente en la lista, todo correcto)
- [X] T026 [US2] Implementar apps/ops/src/preflight.ts (función pura `checkConfig({wrangler, webEnv, secrets, firebaserc})` + lectura de archivos y `wrangler secret list --format json`) y el despachador apps/ops/src/cli.ts
- [X] T027 [P] [US2] Tests de `smoke` en apps/ops/tests/smoke.test.ts contra el stack local (5181 + 8787): todas las comprobaciones pasan; una URL de API errónea falla con el nombre del paso
- [X] T028 [US2] Implementar apps/ops/src/smoke.ts (carga de la app y cabeceras/CSP, `version.json` = `health.version`, health deep, CORS permitido/rechazado, 401 sin token; modo `--light`)
- [X] T029 [US2] Versionado: plugin de Vite que emite `/version.json` (`VITE_APP_VERSION` o `dev`) en apps/web/vite.config.ts; `API_VERSION` en apps/api/src/env.ts y health
- [X] T030 [US2] Script raíz `deploy:prod` (preflight → build web con sha → `firebase deploy --only firestore:rules,firestore:indexes,hosting` → `wrangler deploy --var API_VERSION:<sha>` → smoke) en scripts/deploy.sh y package.json; workflow manual .github/workflows/deploy.yml
- [X] T031 [US2] Configuración de producción: `ratelimits` y `API_VERSION` en apps/api/wrangler.jsonc (y env emulador sin limitador), apps/web/.env.production.example, y docs/deploy.md (alta de Firebase/Cloudflare/B2/Gemini, secretos, despliegue, vuelta atrás con `firebase hosting:rollback` y `wrangler rollback`)

---

## Phase 5: User Story 3 — Backups y recuperación (P1)

**Goal**: copia diaria cifrada fuera de Firestore y restauración probada.

**Independent Test**: apps/ops/tests/restore.test.ts (simulacro completo contra el emulador).

- [X] T032 [P] [US3] Tests en apps/ops/tests/crypto.test.ts (ida y vuelta, clave errónea y datos alterados fallan) y apps/ops/tests/retention.test.ts (7 diarias + domingos de 28 días)
- [X] T033 [P] [US3] Implementar apps/ops/src/crypto.ts (gzip + AES-256-GCM, formato GVB1) y apps/ops/src/retention.ts (selección pura)
- [X] T034 [US3] Test de simulacro en apps/ops/tests/restore.test.ts: sembrar con la API (viaje con gastos, pagos, notificaciones, adjunto), `backup` a directorio, comparar con `listCollectionIds` recursivo (completitud), vaciar el emulador, `restore`, comparar documentos uno a uno y saldos; baja posterior a la copia → `restore` la reaplica (registro y Auth inexistente)
- [X] T035 [US3] Implementar apps/ops/src/collections.ts (ids de colección conocidos), apps/ops/src/backup.ts (runQuery por collection group paginado, NDJSON, manifiesto), apps/ops/src/s3.ts (destino directorio o B2 con aws4fetch: put/get/list/delete), apps/ops/src/restore.ts (descifrar, verificar sha256, commit por lotes de 500, `reconcile` usando `reconcileDeletions` de apps/api/src/services/accountDeletion.ts), comandos `backup|prune|restore|reconcile` en apps/ops/src/cli.ts
- [X] T036 [US3] Workflow .github/workflows/backup.yml (diario 03:30 UTC, `backup` + `prune`, secretos `FIREBASE_SERVICE_ACCOUNT`, `BACKUP_KEY`, `BACKUP_B2_*`; sin imprimir PII) y procedimiento de restauración en docs/operations.md

---

## Phase 6: User Story 4 — Monitoreo y operación (P2)

**Goal**: enterarse de caídas y consumo; investigar sin PII.

- [X] T037 [P] [US4] Tests en apps/api/tests/ops.test.ts: health básico (`version`, `environment`), `?deep=1` con Firestore ok; middleware de log emite una línea `request` por petición con ruta-patrón y sin email/nombre/importes (captura de `console.log`, SC-009); `RESOURCE_EXHAUSTED` de Firestore → 503 SERVICE_UNAVAILABLE con `retryAfter`
- [X] T038 [US4] Implementar health ampliado, apps/api/src/http/requestLog.ts y el mapeo `RESOURCE_EXHAUSTED` en apps/api/src/index.ts (y estado en FirestoreError de apps/api/src/firestore/client.ts si hace falta)
- [X] T039 [US4] Workflow .github/workflows/uptime.yml (cada 15 min, `ops smoke --light` contra `APP_URL`/`API_URL` de variables del repo; se omite si no están configuradas)
- [X] T040 [US4] docs/operations.md: límites y consumo (research R13), umbrales y acciones, cómo buscar por `x-correlation-id` en Workers Observability, alertas y la desactivación de crons tras 60 días sin actividad

---

## Phase 7: User Story 5 — Hardening y piloto (P2)

**Goal**: seguridad, accesibilidad y rendimiento verificados; lista de lanzamiento.

- [X] T041 [P] [US5] Tests del limitador en apps/api/tests/http/rateLimit.test.ts (binding falso: 121.ª petición del mismo uid → 429 con `Retry-After`; otro uid no afectado; rutas públicas por IP; sin binding no limita)
- [X] T042 [US5] Implementar apps/api/src/http/rateLimit.ts y engancharlo en apps/api/src/index.ts (IP antes de autenticar en rutas públicas, uid después de verificar el token); `RATE_LIMIT_USER`/`RATE_LIMIT_IP` opcionales en env.ts; cabeceras `nosniff` y `Cache-Control: no-store` por defecto
- [X] T043 [P] [US5] Plugin CSP de Vite (meta `http-equiv` generada desde `VITE_*`, con hosts de emulador solo si `VITE_USE_EMULATORS`) en apps/web/config/csp.ts + apps/web/vite.config.ts; Zod `jitless` en su propio chunk (sin `new Function`), con test unitario en apps/web/tests/unit/csp.test.ts
- [X] T044 [US5] Cabeceras de Hosting en firebase.json (HSTS, X-Frame-Options DENY, Permissions-Policy, COOP `same-origin-allow-popups`, no-cache para index.html y sw.js)
- [X] T045 [US5] E2E apps/web/tests/e2e/pwa/csp.spec.ts: sobre el build, la app inicia sesión, crea viaje y gasto sin errores `securitypolicyviolation` en consola
- [X] T046 [US5] Web: mensajes para RATE_LIMITED y SERVICE_UNAVAILABLE (con `retryAfter`) en apps/web/src/components/ErrorMessage.tsx / apps/web/src/lib/apiClient.ts, con test en apps/web/tests/unit/errors.test.ts
- [X] T047 [US5] Ampliar apps/web/tests/e2e/a11y.spec.ts a notificaciones, pendientes, cuenta/baja y pagos con eliminado
- [X] T048 [US5] Job `lighthouse` en .github/workflows/ci.yml (build con env de emulador, `vite preview`, `lighthouse` móvil en /login con umbrales accesibilidad ≥ 0,9, buenas prácticas ≥ 0,9, rendimiento ≥ 0,8 vía apps/web/scripts/lighthouse.mjs) y job `ops` (tests de ops con emuladores)
- [X] T049 [US5] Revisión de seguridad documentada en docs/security-review.md (auth por ruta, Rules, URLs firmadas, exportaciones, baja, CORS/CSP, secretos, logs, rate limiting) con hallazgos resueltos o aceptados
- [X] T050 [P] [US5] docs/launch-checklist.md (cada punto del PRD §15 → evidencia: test, medición o verificación manual) y docs/pilot-guide.md (tareas, métricas, formulario de hallazgos, aviso de privacidad sobre Gemini y retención de backups)

---

## Phase 8: Polish

- [X] T051 Medición de CPU de `anonymizeInTrip` en apps/api/tests/perf/ (< 10 ms por viaje) y de la baja de 10 viajes (< 60 s, SC-003)
- [X] T052 Actualizar README.md (comandos ops, despliegue, enlaces a docs/), constitution «Decisiones pendientes» (PRD #2 y #7 resueltas) y spec checklists
- [X] T053 Ejecutar todo: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm --filter api perf`, `pnpm --filter ops test`, `pnpm --filter web test:e2e`; recorrido del quickstart

---

## Dependencies & Execution Order

- Setup (T001–T003) → Foundational (T004–T006) → historias.
- US1 (T007–T024) es el MVP y bloquea T035 (reconcile reutiliza la anonimización) y T047.
- US2 (T025–T031) y US4 (T037–T040) son independientes de US1; T028 depende de T029 y T042 (cabeceras).
- US3 (T032–T036) depende de T001 y de T013 para `reconcile`.
- US5: T041–T042 independientes; T045 depende de T043–T044; T049–T050 al final.

## Parallel Example

```text
T002, T003 (contracts) ‖ T005, T006 (api)  →  T007–T012 (tests US1) en paralelo  →  T013…
T025/T027 (ops tests) ‖ T032 (crypto/retention tests) ‖ T037 (ops API tests) ‖ T041 (rate limit tests)
```

## Implementation Strategy

1. MVP: US1 (RF-56) completa con E2E.
2. US3 (backups) y US2 (despliegue): necesarias antes del piloto.
3. US4 y US5: monitoreo y hardening; documentación de lanzamiento al final.
