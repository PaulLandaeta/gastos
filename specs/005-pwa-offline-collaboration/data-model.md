# Data Model: PWA y colaboración (Fase 5)

## Dispositivo (IndexedDB, por cuenta)

### PendingExpense — base `gastos-outbox-<uid>`, store `pendingExpenses` (clave `localId`)

| Campo | Tipo | Notas |
|---|---|---|
| localId | string (UUID) | id local estable; se muestra como gasto «pendiente» |
| idempotencyKey | string (UUID v4) | fijada al crear; **se conserva al editar** (clarificación 4) |
| tripId | string | |
| input | `CreateExpenseInput` (Zod de `contracts`) | validado al crear y al editar; sin adjuntos ni `scanId` |
| status | `pending` \| `sending` \| `needs_attention` | `synced` = borrado del store |
| attempts | number | para el backoff |
| nextAttemptAt | Date \| null | |
| error | `{ code, message, details? }` \| null | motivo de `needs_attention` |
| confirmDuplicate | boolean | se activa con «Enviar igualmente» tras `POSSIBLE_DUPLICATE` |
| createdAt / updatedAt | Date | el envío respeta `createdAt` |

Transiciones:

```text
pending ──sync──▶ sending ──2xx──▶ (borrado; gasto real en servidor)
   ▲  │                  ├─ NETWORK/5xx/429 ─▶ pending (backoff)
   │  │                  └─ 4xx negocio ─────▶ needs_attention
   │  └─ editar/descartar (autor)                     │
   └──────── corregir + reenviar ◀────────────────────┤
                                  descartar ─▶ (borrado)
```

- `sending` bloquea la edición. Un `sending` huérfano (la app se cerró a mitad) vuelve a `pending` al arrancar.
- Códigos no recuperables (`FORBIDDEN`, `NOT_FOUND`, `TRIP_READ_ONLY`, `TRIP_NOT_READY`): `needs_attention` con solo
  «Descartar» (se puede copiar el contenido para registrarlo de otra forma).
- Errores corregibles (`VALIDATION_FAILED`, `NOT_RECONCILED`, `INVALID_ALLOCATION`, `PAYER_NOT_MEMBER`,
  `CATEGORY_INACTIVE`, `PARTICIPANTS_LOCKED`, `CURRENCY_LOCKED`, `POSSIBLE_DUPLICATE`): editar y reenviar, o descartar.
- `UNAUTHENTICATED`: no cambia el estado; se pide iniciar sesión de nuevo y se reintenta.

### TripAccess — store `tripAccess` (clave `tripId`)

| Campo | Tipo | Notas |
|---|---|---|
| tripId | string | |
| lastOpenedAt | Date | se actualiza al abrir el viaje con conexión |
| lastSyncedAt | Date | se muestra como «Actualizado el …» sin conexión |

Purga al arrancar: viajes con `lastOpenedAt` > 30 días → fuera de la lista offline y sus consultas persistidas se
eliminan (clarificación 1).

### Persistencia de consultas — `rq-cache:<uid>` (idb-keyval)

Estado deshidratado de TanStack Query (solo consultas `meta.persist`), `maxAge` 30 días, `buster` = versión de la app.

### Marca de propietario — `localStorage.cacheOwnerUid`

Si no coincide con el uid de la sesión: se borran la caché de Firestore y la de consultas antes de mostrar datos.

## Servidor (Firestore)

### Notification — `users/{uid}/notifications/{notificationId}`

| Campo | Tipo | Notas |
|---|---|---|
| type | enum | `expense.created` · `expense.updated` · `expense.removed_from` · `expense.voided` · `expense.restored` · `settlement.pending` · `settlement.confirmed` · `settlement.rejected` · `refund.received` · `attachment.expiring` · `trip.status_changed` · `invitation.received` |
| tripId | string | |
| tripName | string | |
| entity | `{ kind: 'expense'\|'settlement'\|'refund'\|'attachment'\|'trip'\|'invitation', id }` | |
| title | string | texto mínimo permitido (sin datos de gastos no visibles) |
| body | string \| null | descripción e importe **solo** si el destinatario ve el gasto |
| link | string | ruta de la app (p. ej. `/trips/t1/expenses/e9`) |
| actorUid | string | nunca igual al destinatario |
| createdAt | timestamp | |
| readAt | timestamp \| null | |
| expiresAt | timestamp | `createdAt + 90 días` |
| schemaVersion | 1 | |

Reglas de generación (`notificationsFor`):

| Evento | Destinatarios |
|---|---|
| gasto creado / anulado / restaurado | pagadores y beneficiarios − autor |
| gasto editado | usuarios cuya parte pagada o consumida cambió, o que fueron añadidos − autor; los quitados reciben `expense.removed_from` sin detalle |
| pago registrado | receptor |
| pago confirmado / rechazado | emisor |
| devolución | beneficiarios de la devolución − autor |
| comprobante por vencer | quienes ven el gasto (o emisor y receptor del pago), una vez por adjunto |
| cambio de estado del viaje | miembros aceptados − autor (sin datos financieros) |
| invitación | invitado si ya tiene cuenta (por email verificado). Si aún no tiene cuenta no se genera notificación: la invitación pendiente se muestra al entrar con ese email, como en la Fase 1 |

Cambios auxiliares: `attachments.expiringNotifiedAt: timestamp | null`.

### AuditEvent (existente) — nueva acción

`trip.exported` con `entityType: 'trip'`, `redactedDiff: { format, scope: 'all' | 'visible' }`.

## Exportación (efímera, sin persistencia)

`TripExportPage` (respuesta de cada petición) = `{ header?: TripExportHeader, expenses: [...], voidedExpenses: [...],
refunds: [...], nextCursor: string | null }`; `header` solo en la primera página. El cliente compone `TripExport` = header + todas las
páginas. `TripExport` (Zod en `packages/contracts/src/api/export.ts`):

```text
trip: { id, name, currency, decimals, status, startDate, endDate }
generatedAt, generatedBy: { uid, displayName }, scope: 'all' | 'visible'
members: [{ uid, displayName, status }]
categories: [{ id, name }]
expenses: [{ id, transactionDate, createdAt, description, categoryName, type, totalMinor, status, origin,
             payers: [{ uid, amountMinor }], allocations: [{ uid, amountMinor }],
             items: [{ name, quantity, unitPriceMinor, totalMinor, allocations }], adjustments }]
voidedExpenses: [... mismo formato, listados aparte]
settlements: [{ id, fromUid, toUid, amountMinor, status, createdAt, confirmedAt }]
refunds (por página): [{ id, expenseId, itemId, quantity, amountMinor, recipientUid, createdAt }]
balances: [{ uid, paidMinor | null, consumedMinor | null, netMinor }]   // null: datos de otros para un participante (FR-026)
debts: { original: [{ fromUid, toUid, amountMinor }], simplified: [...] }
totals: { sharedMinor, personalMinor, byCategory: [{ categoryName, totalMinor }] }
```

Invariantes verificados en tests: Σ `balances.netMinor` = 0; los totales de `TripExport` coinciden con
`GET /balances`; para un participante, `expenses` ⊆ gastos con `canViewExpense`.
