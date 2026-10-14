# Data Model: Liquidaciones, edición, restauración y devoluciones

Extiende 001 y 002. Importes enteros en unidad menor; `version` + `schemaVersion`; solo la API escribe.

## `trips/{tripId}/settlements/{settlementId}` (nuevo)

| Campo | Tipo | Reglas |
|---|---|---|
| fromUid | uid | emisor = quien lo registra; miembro aceptado |
| toUid | uid | receptor; miembro aceptado; ≠ fromUid |
| amountMinor | int > 0 | moneda del viaje |
| note | string \| null | ≤ 200 |
| status | `pending` \| `confirmed` \| `rejected` \| `cancelled` | ver máquina de estados |
| rejectionReason | string \| null | ≤ 200, solo si `rejected` |
| resolvedBy | uid \| null | receptor (confirm/reject) o emisor (cancel) |
| createdAt, resolvedAt | timestamp | |
| idempotencyKey | string | UUID v4 |
| schemaVersion, version | int | |

Estados: `pending → confirmed` (receptor) · `pending → rejected` (receptor) · `pending → cancelled`
(emisor). Estados finales inmutables. Viaje cerrado/archivado → toda transición `TRIP_READ_ONLY`.
Lectura cliente: todo miembro aceptado (grafo de deudas, RF-39).

## `trips/{tripId}` (campo nuevo)

| Campo | Tipo | Reglas |
|---|---|---|
| confirmedSettlementCount | int ≥ 0 | +1 al confirmar; decide si la previsualización es obligatoria (FR-014) |

## `trips/{tripId}/expenses/{expenseId}` — schemaVersion 3

| Cambio | Detalle |
|---|---|
| `items[].quantity` | int ≥ 1 (por defecto 1) |
| `status` | `active` ⇄ `voided` (restaurable) |
| `restoredAt` | timestamp \| null |
| `refundedByItem` | map itemId → `{ quantity, amountMinor }` acumulado de devoluciones (para límites y edición) |
| `viewerUids` | se recalcula en cada edición (pagadores ∪ beneficiarios ∪ `createdBy` original) |

`seq` y `createdBy` son inmutables también en edición.

## `trips/{tripId}/expenses/{expenseId}/refunds/{refundId}` (nuevo)

| Campo | Tipo | Reglas |
|---|---|---|
| itemId | string | ítem existente del gasto |
| quantity | int ≥ 0 | Σ por ítem ≤ `item.quantity` |
| amountMinor | int > 0 | Σ por ítem ≤ `maxMinor` (neto + parte de ajustes) |
| recipientUid | uid | miembro aceptado que recibió el dinero |
| sharedMinor, personalMinor | int | reparto de la reducción según clasificación del ítem |
| chargesDelta | map uid → int | reducción de consumo por beneficiario (positiva) |
| ledgerEffect | LedgerEffect | `refundEffect` del motor |
| createdBy | uid | pagador, beneficiario, autor, creador o admin (Q3) |
| createdAt | timestamp | |
| idempotencyKey | string | |
| schemaVersion, version | int | |

Cuenta en saldos y proyecciones solo mientras el gasto padre está `active`.
Lectura cliente: igual que el gasto padre (`viewerUids` del padre o rol creador/admin).

## Proyecciones

- `projections/ledger`: + `paymentEffect` al confirmar; ± efectos de gasto/devoluciones al editar,
  anular, restaurar y devolver. `version` = `ledgerRevision` para previsualización.
- `projections/public`, `projections/categories`, `memberStats/*`: devoluciones como «gasto
  negativo» sin contar en `expenseCount`; ediciones como −viejo +nuevo.

## Motor (`packages/finance-engine`, nuevas funciones puras)

```text
itemAdjustmentShares(expenseInput) → map itemId → int   // ajustes generales repartidos por neto de ítem
itemRefundable(expenseInput, itemId) → { quantity, netMinor, adjustmentShareMinor, maxMinor }
suggestRefund(refundable, alreadyRefunded, quantity) → amountMinor  // proporcional, ≤ restante
itemChargesByMember(expenseInput, itemId) → map uid → int           // cargo del ítem por beneficiario
refundEffect({ amountMinor, recipientUid, itemCharges, rotation }) → { ledgerEffect, chargesDelta }
balancesPreview(ledger, deltaEffects[], members) → { before[], after[], delta[] }
```
