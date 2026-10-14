# Contrato HTTP API v1 — cambios de la feature 003

Base: contratos de 001 y 002. Solo lo nuevo o modificado. Ampliado por [004](../../004-receipts-ai-attachments/contracts/http-api.md) (comprobantes en pagos, `attachmentUploadIds`/`scanId` al crear gastos).

## Códigos de error nuevos

| ErrorCode | HTTP | Cuándo |
|---|---|---|
| PREVIEW_REQUIRED | 409 | edición/anulación/restauración en un viaje con pagos confirmados sin `expectedLedgerRevision`; `details.preview` trae la comparación |
| REFUND_EXCEEDS | 422 | la devolución supera cantidad o importe reembolsable; `details: { maxQuantity, maxMinor }` |
| REFUND_CONSTRAINT | 422 | una edición elimina un ítem con devoluciones o lo deja por debajo de lo devuelto |

`CONFLICT` también se usa cuando `expectedLedgerRevision` no coincide (los saldos cambiaron).

## Pagos

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips/{t}/settlements` | miembro aceptado (emisor) | header `Idempotency-Key`; `{ toUid, amountMinor, note? }` → `201 { settlement, exceedsDebt: boolean }` |
| `POST /trips/{t}/settlements/{s}/confirm` | receptor | `{ expectedVersion }` → `200 { settlement, trip }` (aplica al ledger) |
| `POST /trips/{t}/settlements/{s}/reject` | receptor | `{ expectedVersion, reason? }` → `200 { settlement }` |
| `POST /trips/{t}/settlements/{s}/cancel` | emisor | `{ expectedVersion }` → `200 { settlement }` |

Viaje cerrado/archivado → `TRIP_READ_ONLY`; estado no `pending` → `INVALID_TRANSITION`; otra persona
→ `FORBIDDEN`; ajenos → 404.

## Gastos

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `PUT /trips/{t}/expenses/{e}` | autor, creador, admin | cuerpo de alta (002, ítems con `quantity`) + `{ expectedVersion, expectedLedgerRevision? }` → `200 { expense, trip }` |
| `POST /trips/{t}/expenses/{e}/preview` | quien puede ver el gasto | `{ action: "edit" \| "void" \| "restore", body? }` → `200 { before, after, delta, ledgerRevision, requiresConfirmation }` |
| `POST /trips/{t}/expenses/{e}/void` | (002) | + `expectedLedgerRevision?` |
| `POST /trips/{t}/expenses/{e}/restore` | autor, creador, admin | `{ expectedVersion, expectedLedgerRevision?, confirmDuplicate? }` → `200 { expense }` |

`before`/`after`/`delta`: `[{ uid, netMinor }]` de todos los miembros aceptados (los saldos ya son
públicos; FR-024 se cumple porque solo quien ve el gasto puede pedir su previsualización).

## Devoluciones

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `GET /trips/{t}/expenses/{e}/items/{itemId}/refundable` | quien puede ver el gasto | `?quantity=` → `{ quantity, refundedQuantity, maxMinor, refundedMinor, suggestedMinor }` |
| `POST /trips/{t}/expenses/{e}/refunds` | pagador, beneficiario, autor, creador, admin (Q3) | header `Idempotency-Key`; `{ itemId, quantity, amountMinor, recipientUid }` → `201 { refund, expense }` |

Las devoluciones de un gasto vigente aplican sus efectos; en uno anulado se rechazan
(`INVALID_TRANSITION`).
