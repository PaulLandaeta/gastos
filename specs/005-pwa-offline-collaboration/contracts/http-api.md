# Contrato HTTP API v1 — cambios de la feature 005

Base: contratos de 001–004. Sin códigos de error nuevos.

## Creación de gastos (sin cambios de forma)

`POST /trips/{t}/expenses` ya exige `Idempotency-Key`. La cola offline lo usa tal cual:

- misma clave + mismo usuario → misma respuesta `201` con el gasto ya creado (sin segundo efecto);
- `confirmDuplicate: true` se envía solo tras confirmar un `POSSIBLE_DUPLICATE`;
- **nuevo test obligatorio**: 20 envíos con claves distintas, cada uno repetido 3 veces de forma concurrente →
  exactamente 20 gastos (SC-001).

Cada mutación existente (gastos, pagos, devoluciones, estado del viaje, invitaciones) escribe además las
notificaciones correspondientes **en la misma transacción** (data-model §Notification).

## Notificaciones

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /me/notifications/read` | el propio usuario | `{ ids: string[] (1–100) } \| { all: true }` → `200 { updated }` |
| `POST /me/notifications/unread` | el propio usuario | `{ ids: string[] (1–100) }` → `200 { updated }` |

La lectura de la bandeja es directa desde Firestore (Rules: solo el dueño). Ids ajenos o inexistentes se ignoran
(`updated` cuenta solo los propios).

## Exportación

| Método y ruta | Quién | Respuesta |
|---|---|---|
| `GET /trips/{t}/export?format=xlsx\|pdf&cursor=` | miembro aceptado | `200 TripExportPage` (data-model) |

- **Paginado** para respetar los 10 ms de CPU del Worker Free: cada página trae como máximo 100 gastos visibles
  (ordenados por `seq`, el número de registro), sus devoluciones y `nextCursor` (`null` en la última). Medido:
  ~3,5 ms de CPU por página de 100 gastos con 5 ítems y 10 personas (`perf/export.perf.ts`).
- **Primera página** (sin `cursor`): además incluye `header` (viaje, miembros, categorías, pagos, devoluciones, saldos,
  deudas original y simplificada, totales) calculado desde las proyecciones, y registra la auditoría `trip.exported`
  (formato y `scope`). Las páginas siguientes no auditan ni recalculan saldos.
- `header.balances`: el saldo neto de todos siempre (RF-39); lo que cada uno aportó y consumió solo para gestores
  (FR-026), `null` para los demás en la exportación de un participante.
- `cursor` es opaco y está ligado al viaje y al usuario (`tripId`, uid y último `seq`); uno ajeno o mal formado →
  `VALIDATION_FAILED`. No necesita firma: solo decide desde dónde seguir, y cada página vuelve a filtrar por
  visibilidad.
- Orden: auth → membresía aceptada → (página 1: proyecciones, pagos, devoluciones, `finance-engine`, auditoría) →
  página de gastos → filtro `canViewExpense` (gestores: todo) → respuesta. El cliente concatena páginas hasta
  `nextCursor = null` y compone el `TripExport` completo.
- Cabeceras: `Cache-Control: no-store`.
- Viajes cerrados y archivados se pueden exportar. `format` solo se usa para la auditoría.
- Errores: `NOT_FOUND` (viaje inexistente, no miembro o invitado no aceptado, sin revelar cuál), `VALIDATION_FAILED`
  (formato o cursor inválido).

## Local (solo `ENVIRONMENT=emulator`)

- `POST /local-admin/run-retention?now=<ISO>` además genera avisos `attachment.expiring` y borra notificaciones
  vencidas, para poder probarlo con fecha simulada.
