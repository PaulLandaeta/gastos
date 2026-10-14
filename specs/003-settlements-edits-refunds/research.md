# Research: Liquidaciones, edición, restauración y devoluciones (Fase 3)

**Feature**: `003-settlements-edits-refunds` · **Fecha**: 2026-10-13 · **Base**: 001 + 002.

## R1. Pagos (settlements)

- **Decision**: `trips/{t}/settlements/{id}` con estados `pending → confirmed | rejected | cancelled`.
  Solo `confirmed` aplica `paymentEffect` (motor de 001) a `projections/ledger` en la misma
  transacción; el viaje lleva `confirmedSettlementCount` (para FR-014) y su `version` sube, así la UI
  refresca saldos. Correcciones = pago en sentido contrario (Q1), nunca reversión.
- **Rationale**: el motor ya modela pagos confirmados (001) y la proyección es aditiva. Los pagos son
  parte del grafo de deudas visible para todos (RF-39), por lo que son legibles por todo miembro.
- **Alternatives**: aplicar el pago al crearlo y revertir al rechazar (rechazado: viola FR-002 y
  complica la auditoría).

## R2. Edición con control optimista (RF-36)

- **Decision**: `PUT /trips/{t}/expenses/{e}` con el cuerpo del alta + `expectedVersion`. En la
  transacción: permisos (autor/creador/admin), viaje activo, gasto vigente, versión, categoría
  activa, restricciones de devoluciones, `computeExpense` con el **mismo `seq`**, delta de ledger
  (−efecto viejo + efecto nuevo) y de proyecciones (−gasto viejo + gasto nuevo con sus `viewerUids`
  recalculados = pagadores ∪ beneficiarios ∪ autor original). Conflicto → `409 CONFLICT
  {currentVersion}`; el cliente ya tiene el documento actual en vivo (Firestore) y muestra el diff
  campo a campo contra su borrador, sin perderlo.
- **Historial**: `expense.update` con `redactedDiff.changed = [campos]` (sin importes por ítem).

## R3. Previsualización de impacto (RF-28, FR-013/014)

- **Decision**: `POST /trips/{t}/expenses/{e}/preview` `{ action: edit|void|restore, body? }` →
  `{ before, after, delta, ledgerRevision, requiresConfirmation }` calculado en memoria sobre la
  proyección `ledger` (sin escribir). `ledgerRevision` = `projections/ledger.version`.
  Las mutaciones aceptan `expectedLedgerRevision`; si `trip.confirmedSettlementCount > 0` y falta →
  `409 PREVIEW_REQUIRED` con la previsualización en `details` (el cliente la muestra y reenvía);
  si no coincide con la revisión actual → `409 CONFLICT` («los saldos cambiaron, recalcula»).
- **Rationale**: un único viaje de ida y vuelta en el caso normal; la garantía de FR-014 se aplica
  en el servidor, no solo en la UI.

## R4. Devoluciones por ítem (RF-37)

- **Decision**: `trips/{t}/expenses/{e}/refunds/{r}` (subcolección del gasto: misma visibilidad).
  Campos: `itemId`, `quantity`, `amountMinor`, `recipientUid`, `ledgerEffect`, `chargesDelta`,
  `sharedMinor`/`personalMinor`, autor, fecha.
- **Motor** (nuevas funciones puras en `finance-engine`):
  - `itemRefundable(expenseInput, itemId)` → `{ quantity, netMinor, adjustmentShareMinor,
    maxMinor }`: la parte de ajustes generales del ítem se reparte entre ítems en proporción a su
    neto (mayor residuo, rotación por índice).
  - `suggestRefund(…, quantity)` → importe proporcional (Q2): `maxMinor × q / quantity` con
    redondeo hacia abajo (nunca supera el máximo).
  - `refundEffect({ amountMinor, recipientUid, item allocation by beneficiary, seq })` → reparte
    la reducción de consumo entre los beneficiarios del ítem en proporción a su cargo del ítem;
    `netByMember[b] += share_b`, `netByMember[recipient] −= amount`; `pairwise[recipient>b] += share_b`.
    Suma cero por construcción y la vista original sigue netando exacto.
- **Límites**: Σ cantidades ≤ `quantity` del ítem y Σ importes ≤ `maxMinor` (validado en
  transacción leyendo las devoluciones previas del ítem).
- **Anulación/restauración**: al anular un gasto se restan su efecto y el de sus devoluciones; al
  restaurar se suman (las devoluciones conservan su estado propio).
- **Edición**: no puede eliminar un ítem con devoluciones ni dejar su cantidad/neto por debajo de lo
  devuelto (`422 REFUND_CONSTRAINT`).
- **Proyecciones**: una devolución entra como «gasto negativo» (consumo −, `sharedTotal −`,
  aporte del receptor −) sin cambiar `expenseCount` (`applyExpense(…, { count: 0 })`).

## R5. Cantidad de ítem

- **Decision**: `quantity` entero ≥ 1 (por defecto 1) en los ítems del formulario y del contrato
  (schemaVersion de gasto 3); el motor la ignora en el reparto (solo afecta a devoluciones).

## R6. Restauración

- **Decision**: `POST …/expenses/{e}/restore` `{ expectedVersion, expectedLedgerRevision?,
  confirmDuplicate? }`; mismos permisos que anular; aplica la detección de duplicados de 002
  excluyendo el propio gasto; restaura aunque la categoría esté inactiva (spec US4).

## R7. Presupuesto free tier

| Operación | Lecturas | Escrituras |
|---|---|---|
| Registrar pago | trip + miembros + idem | pago, trip, idem, audit |
| Confirmar pago | trip + miembros + pago + ledger | pago, trip, ledger, audit |
| Editar gasto | ~14 (como alta + gasto previo + devoluciones del gasto) | ~12 |
| Previsualizar | trip + miembros + gasto + ledger | 0 |
| Devolución | trip + miembros + gasto + devoluciones del ítem + ledger + proyecciones | ~9 |

Sin impacto apreciable sobre los límites diarios con el volumen previsto (4 personas).
