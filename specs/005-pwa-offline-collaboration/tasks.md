# Tasks: PWA y colaboración (Fase 5)

**Input**: Design documents from `specs/005-pwa-offline-collaboration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obligatorios (constitution, Principio V — test-first). Cada test se escribe antes que su implementación y
debe fallar primero.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1 offline · US2 PWA · US3 notificaciones · US4 exportación

---

## Phase 1: Setup

- [X] T001 Añadir dependencias web `idb@8`, `idb-keyval@6`, `@tanstack/react-query-persist-client@5`, `@tanstack/query-async-storage-persister@5`, `write-excel-file@4`, `jspdf@4`, `jspdf-autotable@5` y dev `fake-indexeddb@6` en apps/web/package.json (`pnpm --filter web add …`)
- [X] T002 [P] Configurar `fake-indexeddb/auto` como setup de Vitest de la web en apps/web/vitest.config.ts (crear si no existe, entorno `jsdom` solo para tests que lo pidan)
- [X] T003 [P] Añadir proyecto Playwright `pwa` que levanta `vite build && vite preview --port 5181 --strictPort` con las mismas env vars y `baseURL` http://localhost:5181, ejecutando solo `tests/e2e/pwa/**`, en apps/web/playwright.config.ts (el proyecto `mobile-chrome` ignora esa carpeta)
- [X] T004 [P] Añadir el origen http://localhost:5181 a los orígenes CORS del entorno emulador (localizar con `grep -rn "5180" apps/api/src apps/api/wrangler.jsonc` y añadirlo junto a ese valor)

---

## Phase 2: Foundational (bloquea las historias)

- [X] T005 [P] Tests de esquemas `NotificationType`, `Notification`, `NotificationsReadBody` (ids 1–100 o `{all:true}`) y `TripExport` en packages/contracts/tests/phase5.test.ts
- [X] T006 [P] Crear packages/contracts/src/notifications.ts (enum de tipos de data-model, esquema Zod, bodies read/unread) y exportarlo en packages/contracts/src/index.ts
- [X] T007 [P] Crear packages/contracts/src/api/export.ts con `TripExportHeader`, `TripExportPage` y `TripExport` (Zod, data-model §Exportación) y exportarlo en packages/contracts/src/index.ts
- [X] T008 Implementar `useOnline()` (navigator.onLine + eventos + `reportNetworkFailure()`/`reportNetworkSuccess()` llamados desde `api()`) en apps/web/src/lib/useOnline.ts y engancharlo en apps/web/src/lib/apiClient.ts
- [X] T009 Implementar separación por cuenta: `ensureCacheOwner(uid)` y `clearLocalData()` (terminate + clearIndexedDbPersistence, borrar `rq-cache:*`, `localStorage.cacheOwnerUid`) en apps/web/src/lib/cacheOwner.ts, con test unitario en apps/web/tests/unit/cacheOwner.test.ts

**Checkpoint**: contratos y utilidades compartidas listas.

---

## Phase 3: User Story 1 — Registrar gastos sin conexión (P1) 🎯 MVP

**Goal**: consultar sin señal lo ya visto y crear gastos que se sincronizan una sola vez.

**Independent Test**: con la app abierta una vez, cortar red, crear 2 gastos, recargar, volver la red → exactamente 2
gastos nuevos y saldos cuadrados.

### Tests (primero)

- [X] T010 [P] [US1] Test de la máquina de estados del outbox (crear con UUID de idempotencia, editar conserva la clave, descartar, `sending` bloquea edición, `sending` huérfano vuelve a `pending`, orden por `createdAt`, aislamiento por uid) en apps/web/tests/unit/outbox.test.ts
- [X] T011 [P] [US1] Test de `syncOutbox` con `api` simulado: 2xx borra, NETWORK/5xx/429 backoff 2 s→5 min, 4xx corregibles vs no recuperables según data-model, `POSSIBLE_DUPLICATE` + `confirmDuplicate`, `UNAUTHENTICATED` no cambia estado, lock evita envíos dobles, en apps/web/tests/unit/sync.test.ts
- [X] T012 [P] [US1] Test de `tripAccess`: registra `lastOpenedAt`, purga > 30 días y elimina sus consultas persistidas, en apps/web/tests/unit/tripAccess.test.ts
- [X] T013 [P] [US1] Test API de idempotencia concurrente SC-001: 20 claves distintas, cada una enviada 3 veces en paralelo (y una con respuesta perdida simulada reenviada) → exactamente 20 gastos y proyecciones cuadradas, en apps/api/tests/routes/expenses.offline.test.ts
- [X] T014 [P] [US1] E2E offline en apps/web/tests/e2e/pwa/offline.spec.ts: abrir viaje con red → `context.setOffline(true)` → recargar muestra viaje, gastos, saldos y barra «Sin conexión» en < 3 s desde la recarga (SC-002, medido con `Date.now()` hasta ver el nombre del viaje); crear 2 gastos (uno por ítems) → «2 pendientes»; editar uno; volver online → 2 gastos reales, sin etiquetas, saldos correctos
- [X] T015 [P] [US1] E2E de rechazo en apps/web/tests/e2e/pwa/offline-attention.spec.ts: pendiente creado offline, otro usuario cierra el viaje vía API, al reconectar queda «Requiere atención» con motivo y solo «Descartar»; caso `CATEGORY_INACTIVE` → editar y reenviar funciona; acciones de pago/escaneo/exportar muestran «Necesita conexión»
- [X] T016 [P] [US1] E2E de permisos cambiados (FR-009) en apps/web/tests/e2e/pwa/offline-permissions.spec.ts: Juan ve un gasto en el que participa → offline → con la API, Ana edita el gasto quitando a Juan → Juan vuelve online → el gasto desaparece de su lista y de su detalle sin recargar manualmente
- [X] T017 [P] [US1] E2E de cambio de cuenta en apps/web/tests/e2e/pwa/offline-account.spec.ts: cerrar sesión con pendiente muestra el aviso; tras confirmar, otra cuenta en el mismo navegador no ve caché ni pendientes

### Implementación

- [X] T018 [US1] Activar `persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: 40 * 1024 * 1024 })` con `initializeFirestore` en apps/web/src/lib/firebase.ts (antes de `connectFirestoreEmulator`)
- [X] T019 [US1] Exponer `fromCache` y la fecha de última sincronización en `useDoc`/`useCollection` (`includeMetadataChanges`) en apps/web/src/lib/useFirestore.ts
- [X] T020 [US1] Persistir consultas marcadas `meta.persist` con `persistQueryClient` + `createAsyncStoragePersister` (idb-keyval, clave `rq-cache:<uid>`, maxAge 30 d, buster = versión) en apps/web/src/lib/queryPersist.ts e integrarlo en apps/web/src/app/queryClient.ts; marcar `meta.persist` en saldos (apps/web/src/features/balances/BalancesPanel.tsx), dashboard (apps/web/src/features/dashboard/DashboardPanel.tsx) y lista de gastos (apps/web/src/features/expenses/ExpenseListPage.tsx); `networkMode: 'offlineFirst'` para que muestren caché sin red; al pasar de offline a online invalidar todas las consultas persistidas (`queryClient.invalidateQueries()`) para que la visibilidad vigente reemplace la caché (FR-009)
- [X] T021 [P] [US1] Implementar `tripAccess` (store `tripAccess`, `touch`, `listRecent`, `purgeOlderThan(30d)`) en apps/web/src/features/offline/tripAccess.ts y llamarlo al abrir viaje en apps/web/src/features/trips/TripDetailPage.tsx
- [X] T022 [US1] Implementar el outbox con `idb` (base `gastos-outbox-<uid>`, store `pendingExpenses`, API `add/update/discard/list/markSending/markResult/resetOrphans`) en apps/web/src/features/offline/outbox.ts
- [X] T023 [US1] Implementar `syncOutbox` (orden, backoff, clasificación de errores de data-model, `navigator.locks`, invalidación de queries tras éxito) y `startSyncTriggers` (online, inicio con sesión, `visibilitychange`, manual) en apps/web/src/features/offline/sync.ts
- [X] T024 [US1] Hook `usePending(tripId?)` reactivo (BroadcastChannel `outbox-<uid>` entre pestañas) en apps/web/src/features/offline/usePending.ts
- [X] T025 [US1] Guardar en el outbox cuando no hay conexión (o falla con NETWORK) en apps/web/src/features/expenses/NewExpensePage.tsx; bloquear creación si el viaje en caché está cerrado/archivado; ocultar adjuntos y escaneo sin conexión
- [X] T026 [US1] Mostrar pendientes arriba de la lista con etiquetas «Pendiente/Enviando/Requiere atención» (no suman a saldos) en apps/web/src/features/expenses/ExpenseListPage.tsx
- [X] T027 [US1] Pantalla `/pending` con Reintentar, Editar (reutiliza `ExpenseForm` con el input guardado), Descartar con confirmación y «Enviar igualmente» para duplicados, en apps/web/src/features/offline/PendingPage.tsx y ruta en apps/web/src/app/router.tsx
- [X] T028 [US1] Barra de estado `role="status"` («Sin conexión · datos del …», «n pendientes», «m requieren atención») en apps/web/src/features/offline/StatusBar.tsx, montada en apps/web/src/app/Layout.tsx
- [X] T029 [US1] Deshabilitar con «Necesita conexión» las acciones online-only (pagos, confirmar, editar/anular, devoluciones, adjuntos, escaneo, gestión del viaje, exportar) usando un componente `RequiresOnline` en apps/web/src/features/offline/RequiresOnline.tsx aplicado en QuickActions, TripStatusActions, ExpenseDetailPage, settlements y scan
- [X] T030 [US1] Cierre de sesión con pendientes (diálogo de contract offline-ui) y llamada a `clearLocalData()`; `ensureCacheOwner(uid)` al iniciar sesión, en apps/web/src/features/auth/AccountMenu.tsx y apps/web/src/features/auth/AuthProvider.tsx; arrancar `startSyncTriggers` tras login

**Checkpoint**: US1 funcional y probada (MVP).

---

## Phase 4: User Story 2 — Instalar la app (P1)

**Goal**: instalable, abre offline y se actualiza sin perder pendientes.

**Independent Test**: manifest válido, SW activo, sin red la app abre el shell en vez de error del navegador.

- [X] T031 [P] [US2] E2E en apps/web/tests/e2e/pwa/install.spec.ts: manifest enlazado con nombre, iconos 192/512 y `display: standalone`; SW `activated`; offline navegando a una ruta profunda carga el shell; tras simular nueva versión (`registration.update` con SW en espera) aparece «Hay una versión nueva» y los pendientes siguen tras «Actualizar»
- [X] T032 [US2] Cambiar a `registerType: 'prompt'`, `workbox.navigateFallback: '/index.html'`, excluir `/v1/**` y dominios de Firestore/B2 del runtime caching, y añadir `apple-touch-icon` y `theme-color` en apps/web/vite.config.ts e apps/web/index.html
- [X] T033 [P] [US2] Aviso de actualización con `useRegisterSW` («Hay una versión nueva» → «Actualizar», nunca recarga sola) en apps/web/src/features/pwa/UpdatePrompt.tsx montado en apps/web/src/app/Layout.tsx
- [X] T034 [P] [US2] Botón «Instalar app» (`beforeinstallprompt`) y guía iOS («Compartir → Añadir a pantalla de inicio», detectando Safari iOS no instalado) en apps/web/src/features/pwa/InstallButton.tsx e apps/web/src/features/pwa/IosInstallGuide.tsx, en el menú de cuenta apps/web/src/features/auth/AccountMenu.tsx

**Checkpoint**: US1 + US2 = PWA offline completa.

---

## Phase 5: User Story 3 — Notificaciones internas (P2)

**Goal**: bandeja con eventos relevantes que respetan RF-38.

**Independent Test**: gasto con Juan → 1 notificación y contador 1; gasto sin Juan → nada; tocarla navega y marca leída.

### Tests (primero)

- [X] T035 [P] [US3] Tests unitarios de `notificationsFor` (tabla de data-model: autor excluido; edición solo si cambia la parte o se añade; quitado recibe `expense.removed_from` sin detalle; no involucrado no recibe nada; gestor no involucrado no recibe aviso de gasto; textos sin datos de gastos no visibles) en apps/api/tests/services/notifications.unit.test.ts
- [X] T036 [P] [US3] Tests de integración en apps/api/tests/routes/notifications.test.ts: crear/editar/anular/restaurar gasto, registrar/confirmar/rechazar pago, devolución, cambio de estado del viaje e invitación generan los documentos esperados en la misma transacción (un fallo de la mutación no deja notificaciones); `POST /me/notifications/read` (ids y `all`) y `/unread` solo afectan a las propias
- [X] T037 [P] [US3] Tests de retención en apps/api/tests/routes/retention.test.ts: el cron genera `attachment.expiring` una sola vez por adjunto (≤ 14 días, `expiringNotifiedAt`) y borra notificaciones con `expiresAt` vencido
- [X] T038 [P] [US3] Tests de Rules en firebase/tests/rules.test.ts: `users/{uid}/notifications` legible solo por el dueño; denegado a otro usuario y gestor; toda escritura del cliente denegada
- [X] T039 [P] [US3] E2E en apps/web/tests/e2e/notifications.spec.ts: Ana crea gasto con Juan y otro privado sin Juan → Juan ve contador 1 en < 10 s, una sola notificación, al tocar navega al gasto y queda leída; marcar no leída y «todas leídas»; gasto anulado del que Juan dejó de ser parte → «ya no disponible»

### Implementación

- [X] T040 [US3] Implementar `notificationsFor(event)` (puro) y `writeNotifications(tx, list, now)` (`expiresAt` = +90 d, `schemaVersion: 1`) en apps/api/src/services/notifications.ts
- [X] T041 [US3] Llamar a `writeNotifications` dentro de la transacción de crear/editar/anular/restaurar gasto en apps/api/src/services/expenses.ts
- [X] T042 [P] [US3] Llamar a `writeNotifications` en registrar/confirmar/rechazar pago en apps/api/src/services/settlements.ts
- [X] T043 [P] [US3] Llamar a `writeNotifications` en devoluciones en apps/api/src/services/refunds.ts
- [X] T044 [P] [US3] Llamar a `writeNotifications` en cambios de estado del viaje en apps/api/src/services/tripStatus.ts e invitaciones (invitado con cuenta existente) en apps/api/src/services/invitations.ts
- [X] T045 [US3] Ampliar el cron: avisos `attachment.expiring` (una vez, marcando `expiringNotifiedAt`) y borrado por lotes de 200 de notificaciones vencidas (collection group) en apps/api/src/services/retention.ts; índice collection group `notifications.expiresAt` en firebase/firestore.indexes.json
- [X] T046 [US3] Rutas `POST /me/notifications/read` y `/unread` (validación Zod, solo propias, máx. 100) en apps/api/src/routes/notifications.ts registradas en apps/api/src/routes/index.ts
- [X] T047 [US3] Regla `match /users/{uid}/notifications/{n} { allow read: if request.auth.uid == uid; allow write: if false; }` en firebase/firestore.rules e índice `readAt + createdAt` en firebase/firestore.indexes.json
- [X] T048 [P] [US3] Hook `useNotifications()` (onSnapshot `orderBy createdAt desc limit 50` + no leídas `readAt == null limit 100`) y mutaciones read/unread en apps/web/src/features/notifications/useNotifications.ts
- [X] T049 [US3] Campana con contador («99+», `aria-label`) en apps/web/src/features/notifications/Bell.tsx en apps/web/src/app/Layout.tsx, y bandeja `/notifications` (leer/no leer, todas leídas, navegar marcando leída) en apps/web/src/features/notifications/NotificationsPage.tsx con ruta en apps/web/src/app/router.tsx
- [X] T050 [US3] Mostrar «Este elemento ya no está disponible» sin detalles cuando el destino no es accesible en apps/web/src/features/expenses/ExpenseDetailPage.tsx (verificar también pagos)

**Checkpoint**: US3 funcional e independiente.

---

## Phase 6: User Story 4 — Exportar a Excel y PDF (P2)

**Goal**: Excel detallado y PDF resumen con privacidad, efímeros y auditados.

**Independent Test**: Pedro exporta un viaje con un gasto privado de Ana → el archivo no lo contiene y los saldos
coinciden con la app.

### Tests (primero)

- [X] T051 [P] [US4] Tests API en apps/api/tests/routes/exports.test.ts: paginación (450 gastos → 5 páginas de ≤ 100, `header` y auditoría solo en la primera, sin duplicados ni huecos, cursor ajeno o manipulado → `VALIDATION_FAILED`); participante no involucrado no recibe el gasto privado (SC-008) pero sí saldos y deudas de todos; creador y admin reciben todo (`scope: 'all'`); invitado no aceptado → `NOT_FOUND`; anulados en `voidedExpenses` y fuera de totales; Σ saldos = 0 y coincide con `GET /balances` (original y simplificada); `Cache-Control: no-store`; auditoría `trip.exported` con formato y alcance; viaje archivado exportable; formato inválido → `VALIDATION_FAILED`
- [X] T052 [P] [US4] Test de perf en apps/api/perf/export.perf.ts: una página de 100 gastos con ítems (parseo REST + filtro + serialización) y la primera página con saldos de un viaje de 1.000 gastos, cada una < 10 ms de CPU
- [X] T053 [P] [US4] Tests unitarios en apps/web/tests/unit/exportFiles.test.ts: `toXlsxSheets(TripExport)` genera hojas Gastos, Ítems, Reparto, Pagos, Devoluciones, Saldos, Deudas (original y simplificada) con importes según decimales de la moneda (incluida moneda sin decimales) y totales que cuadran; `toPdfModel` contiene totales, por categoría, aporte/consumo por persona, deudas simplificadas y fecha
- [X] T054 [P] [US4] E2E en apps/web/tests/e2e/export.spec.ts: Pedro descarga Excel y PDF (`page.waitForEvent('download')`), el XLSX leído no contiene la descripción del gasto privado y los saldos coinciden con la pantalla; Ana (creadora) sí lo ve; nombre de archivo `gastos-{viaje}-{fecha}`; con el viaje de volumen de apps/web/tests/e2e/volume.spec.ts (1.000 gastos) la descarga del Excel termina en < 30 s (SC-007)

### Implementación

- [X] T055 [US4] Implementar `buildExportHeader(...)` (proyecciones, pagos, devoluciones, saldos y deudas con `finance-engine`, totales por categoría y compartido/personal) y `buildExportPage(db, trip, member, cursor)` (≤ 100 gastos por `seq`, filtro `canViewExpense`, cursor ligado a viaje y usuario) en apps/api/src/services/exports.ts
- [X] T056 [US4] Ruta `GET /trips/{t}/export?format=xlsx|pdf&cursor=` (miembro aceptado, `no-store`; en la primera página `header` y auditoría `trip.exported` con `format` y `scope`) en apps/api/src/routes/exports.ts registrada en apps/api/src/routes/index.ts
- [X] T057 [P] [US4] Generador Excel con `write-excel-file` (import dinámico) en apps/web/src/features/export/toXlsx.ts
- [X] T058 [P] [US4] Generador PDF con `jspdf` + `jspdf-autotable` (import dinámico, legible en móvil e imprimible, nota «Incluye solo los gastos que puedes ver» cuando `scope='visible'`) en apps/web/src/features/export/toPdf.ts
- [X] T059 [US4] Menú «Exportar» (descarga todas las páginas hasta `nextCursor = null` y compone `TripExport`; Excel detallado / PDF resumen, progreso «Preparando… n de m gastos», descarga con Blob + `revokeObjectURL`, `RequiresOnline`) en apps/web/src/features/export/ExportMenu.tsx, montado en apps/web/src/features/trips/TripDetailPage.tsx

**Checkpoint**: las cuatro historias funcionan de forma independiente.

---

## Phase 7: Polish & Cross-Cutting

- [X] T060 [P] Añadir las pantallas nuevas (`/pending`, `/notifications`, barra offline, menú exportar) a apps/web/tests/e2e/a11y.spec.ts (axe sin violaciones)
- [X] T061 [P] Añadir en apps/api/tests/routes/privacy.phase5.test.ts un caso cruzado: para cada miembro de un viaje con gastos privados, el conjunto de gastos en sus notificaciones y en su exportación ⊆ los que `canViewExpense` permite (misma función que usan Rules/API)
- [X] T062 Ejecutar todo: `pnpm test`, `pnpm test:rules`, `pnpm --filter api perf`, `pnpm --filter web test:e2e` (ambos proyectos), `npx eslint .`, `pnpm typecheck`; corregir fallos
- [X] T063 Validar el recorrido de specs/005-pwa-offline-collaboration/quickstart.md y actualizar documentación y el comentario obsoleto de offline en apps/web/vite.config.ts

---

## Dependencies & Execution Order

- **Setup (F1)** → **Foundational (F2)** → historias.
- **US1** depende de F2 (cacheOwner, useOnline). **US2** usa el proyecto Playwright `pwa` (T003) y comparte E2E con US1;
  se puede hacer en paralelo con US1 salvo T031 (necesita pendientes de US1 para el caso de actualización).
- **US3** y **US4** solo dependen de F2 (contratos) y son independientes entre sí y de US1/US2; `RequiresOnline`
  (T029) se usa en T059 — si US4 va antes, T059 lo crea.
- Dentro de cada historia: tests → servicios → rutas → UI.

### Parallel Opportunities

- F1: T002–T004. F2: T005–T007.
- US1: tests T010–T017 a la vez; T021 en paralelo con T022.
- US3: T035–T039 a la vez; T042–T044 en paralelo tras T040–T041; T048 en paralelo con la API.
- US4: T051–T054 a la vez; T057 y T058 en paralelo.
- US3 y US4 completas pueden desarrollarse en paralelo.

## Implementation Strategy

1. **MVP**: F1 + F2 + US1 → la app ya sirve en viaje sin señal.
2. + US2 → instalable y actualizable con seguridad.
3. + US3 → colaboración informada.
4. + US4 → cierre de viaje con exportación.
5. Polish y verificación completa; commit sin trailer de co-autoría, push y PR.
