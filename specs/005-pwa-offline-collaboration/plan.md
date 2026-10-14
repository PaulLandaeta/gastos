# Implementation Plan: PWA y colaboración (Fase 5)

**Branch**: `005-pwa-offline-collaboration` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-pwa-offline-collaboration/spec.md`

## Summary

La Fase 5 hace la app usable en viaje y cierra el ciclo colaborativo:

- **Offline**: la lectura usa la caché persistente del SDK de Firestore y la persistencia de TanStack Query en
  IndexedDB, ambas por cuenta y limitadas a 30 días / ~50 MB. Los gastos creados sin conexión van a una **cola local**
  (`outbox`) con `Idempotency-Key` fijada al crear; se sincronizan solos al volver la red y los rechazos quedan en
  «requiere atención».
- **PWA instalable**: el service worker existente pasa a `prompt` (actualización sin perder pendientes) con
  `navigateFallback` y guía de instalación para iOS.
- **Notificaciones internas**: la API las escribe en la misma transacción que la acción, con un módulo puro que aplica
  RF-38; el cliente las lee en vivo desde Firestore. Retención 90 días con el cron existente.
- **Exportación**: la API entrega páginas JSON de ≤ 100 gastos ya filtradas por visibilidad (la primera con saldos,
  deudas y auditoría); el navegador las junta y genera el Excel y el PDF en memoria (nada se almacena en el servidor).

## Technical Context

**Language/Version**: TypeScript 6 (igual que 001–004).

**Primary Dependencies** (nuevas, todas MIT y solo en `apps/web`):
- `idb` 8.x (outbox y `tripAccess`), `idb-keyval` 6.x (persister de consultas).
- `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` 5.x.
- `write-excel-file` 4.x, `jspdf` 4.x + `jspdf-autotable` 5.x — cargados con `import()` dinámico solo al exportar.
- Sin dependencias nuevas en la API.

**Storage**:
- Firestore: `users/{uid}/notifications`, `attachments.expiringNotifiedAt`, auditoría `trip.exported`.
- Dispositivo: caché persistente de Firestore (40 MB), `rq-cache:<uid>` (~10 MB), `gastos-outbox-<uid>`.

**Testing**:
- Vitest (web, `fake-indexeddb`): máquina de estados del outbox, clasificación de errores, backoff, purga de 30 días,
  cambio de cuenta; generación de Excel/PDF a partir de un `TripExport` (lectura del XLSX generado).
- Vitest puro (API): `notificationsFor` con tabla de casos de privacidad.
- API en workerd contra emulador: notificaciones por cada mutación, idempotencia concurrente (SC-001), export por rol
  (SC-008), retención de notificaciones.
- Rules: dueño de notificaciones / negativos.
- Playwright sobre `vite preview` (SW activo): offline con `context.setOffline`, pendientes y sincronización,
  instalabilidad (manifest + SW), bandeja, descarga de exportaciones, axe en las pantallas nuevas.

**Target Platform**: PWA en Android Chrome, iOS Safari 16.4+ y escritorio.

**Performance Goals**: apertura offline < 3 s (SC-002, medido en E2E); notificación visible < 10 s (SC-006); export de
1.000 gastos < 30 s de punta a punta (E2E con el viaje de volumen) y CPU del Worker < 10 ms por página (`perf`, SC-007).

**Constraints**: solo servicios sin tarjeta; ninguna escritura financiera desde el cliente; la caché nunca amplía la
visibilidad (al reconectar se invalidan y refrescan todas las consultas persistidas, FR-009); archivos exportados nunca persistidos fuera del dispositivo del solicitante.

**Scale/Scope**: 4–10 participantes, ~1.000 gastos por viaje. Pantallas nuevas: barra de estado, `/pending`,
`/notifications`, menú de exportación, aviso de actualización e instalación.

## Constitution Check

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | Los pendientes se validan con el mismo Zod/motor y el servidor revalida al sincronizar. Los pendientes no se suman a saldos hasta existir en el servidor. Exportación con enteros en unidad menor y totales del motor; test de cuadre con `/balances`. | ✅ |
| II. Privacidad | La caché solo contiene lo que Rules permitieron leer y se separa/borra por cuenta. `notificationsFor` usa `canViewExpense`; tests negativos con no involucrados. Export filtrado en servidor; `no-store`; archivo efímero. | ✅ |
| III. Escrituras en servidor | La cola offline usa la misma API; leído/no leído por API; notificaciones solo por API/cron. | ✅ |
| IV. Auditable / idempotente | `Idempotency-Key` fijada al crear el pendiente y conservada al editar; auditoría `trip.exported`; conflictos nunca resueltos en contra del servidor. | ✅ |
| V. Test-first | Tests de outbox, notificaciones, export y Rules antes del código; E2E offline. | ✅ |
| VI. Free tier | Presupuesto en research R7: < 500 escrituras/día extra, CPU export < 10 ms. Archivos generados en el cliente. | ✅ |
| VII. PWA accesible | Instalación, offline básico y actualización segura; estados con texto + icono, `role="status"`, axe. | ✅ |
| VIII. Simplicidad | Sin push ni correo; sin Background Sync; caché del SDK en vez de un modelo local propio. | ✅ |

**Re-check post-diseño**: ✅ (sin violaciones nuevas).

## Project Structure

### Documentation (this feature)

```text
specs/005-pwa-offline-collaboration/
├── plan.md · research.md · data-model.md · quickstart.md
└── contracts/ http-api.md · access-rules.md · offline-ui.md
```

### Source Code

```text
packages/contracts/src/
├── notifications.ts      # NotificationType, Notification (Zod), body de read/unread
└── api/export.ts         # TripExport (Zod)

apps/api/src/
├── services/
│   ├── notifications.ts  # notificationsFor(event) puro + writeNotifications(tx, …)
│   ├── exports.ts        # buildTripExport(…) con visibilidad y finance-engine
│   ├── retention.ts      # + avisos attachment.expiring y purga de notificaciones (90 d)
│   └── expenses.ts · settlements.ts · refunds.ts · tripStatus.ts · invitations.ts   # llaman a writeNotifications
├── routes/ notifications.ts (me) · exports.ts
└── services/audit.ts     # entityType ya incluye 'trip'; acción trip.exported

apps/web/src/
├── lib/
│   ├── firebase.ts       # persistentLocalCache + persistentMultipleTabManager
│   ├── cacheOwner.ts     # separación/borrado por cuenta
│   ├── queryPersist.ts   # persistQueryClient (rq-cache:<uid>, 30 d)
│   └── useOnline.ts
├── features/offline/     # outbox.ts (idb), sync.ts, tripAccess.ts, StatusBar, PendingPage, usePending
├── features/pwa/         # UpdatePrompt, InstallButton, IosInstallGuide
├── features/notifications/ # Bell, NotificationsPage, useNotifications
├── features/export/      # ExportMenu, toXlsx.ts, toPdf.ts
└── features/expenses/    # NewExpensePage → outbox cuando offline; lista con pendientes
```

**Structure Decision**: mismo monorepo; offline, PWA, notificaciones y exportación como features nuevas en `apps/web`;
servicios y rutas nuevos en `apps/api`; esquemas compartidos en `contracts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Dos cachés de lectura (SDK de Firestore + persistencia de TanStack Query) | Parte de los datos llegan por Firestore en vivo y parte por la API (saldos, estadísticas). | Una sola caché propia obligaría a duplicar el modelo y la lógica de privacidad en el cliente. |
| Generación de archivos en el navegador | El Worker Free tiene ~10 ms de CPU; un XLSX/PDF de 1.000 gastos no cabe. | Generarlo en el servidor exigiría Workers de pago o almacenar el archivo en B2. |
