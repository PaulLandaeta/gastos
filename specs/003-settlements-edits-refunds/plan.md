# Implementation Plan: Liquidaciones, edición, restauración y devoluciones (Fase 3)

**Branch**: `003-settlements-edits-refunds` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-settlements-edits-refunds/spec.md`

## Summary

Cerrar el ciclo financiero del viaje:

- **Pagos**: pago con confirmación o rechazo del receptor; solo los confirmados entran al ledger,
  usando el `paymentEffect` ya existente en el motor de 001.
- **Edición de gastos**: mismo formulario que en 002, control optimista con diff de conflicto,
  reparto recalculado con el mismo `seq` y visibilidad recalculada.
- **Previsualización de impacto**: calculada en servidor y obligatoria si hay pagos confirmados,
  usando una revisión del ledger como guarda.
- **Restauración** de gastos anulados.
- **Devoluciones por ítem**: movimientos compensatorios calculados con funciones puras nuevas del
  motor (`refundEffect`, `itemRefundable`).

Todo se aplica en transacciones que mantienen el ledger y las proyecciones de 002 como deltas
aditivos y reconstruibles.

## Technical Context

**Language/Version**: TypeScript 6. Sin cambios de stack ni dependencias nuevas.

**Primary Dependencies**: las de 001 y 002.

**Storage**: Firestore.
- Nuevas colecciones: `settlements` y la subcolección `expenses/{e}/refunds`.
- Gasto schemaVersion 3: `quantity` en ítems, `refundedByItem`, restauración.
- Nuevo campo `trip.confirmedSettlementCount`.

**Testing**: Vitest con fast-check para las propiedades nuevas del motor, API en workerd contra el
emulador, Rules y Playwright.

**Target Platform / Project Type**: PWA + Workers, el mismo monorepo.

**Performance Goals**:
- Previsualización en ≤ 4 lecturas, calculada en memoria.
- CPU por request < 5 ms.
- Pago desde la propuesta en < 20 s (SC-006).

**Constraints**:
- Pagos confirmados inmutables.
- Devoluciones que no superen lo reembolsable.
- Suma de saldos = 0 y proyecciones = reconstrucción completa tras cualquier secuencia (SC-003).

**Scale/Scope**:
- 3 pantallas nuevas: pagos, edición de gasto y devolución.
- Componentes nuevos: previsualización de impacto y diff de conflicto.

## Constitution Check

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | `refundEffect` y `balancesPreview` son puros, con suma cero y tests de propiedades. Las ediciones aplican −viejo +nuevo. Las proyecciones se reconstruyen con `rebuildProjections`, ampliado a devoluciones y pagos. | ✅ |
| II. Privacidad | Las devoluciones heredan la visibilidad del gasto (Rules + `canViewExpense`). La previsualización solo la pide quien ve el gasto. Los pagos forman parte del grafo público (RF-39). | ✅ |
| III. Escrituras en servidor | Pagos, ediciones, restauraciones y devoluciones solo pasan por la API. | ✅ |
| IV. Auditable, versionado, idempotente | Versiones en gasto y pago, `expectedLedgerRevision`, `Idempotency-Key` en pagos y devoluciones, auditoría de cada transición. Los pagos confirmados son inmutables y se corrigen con un pago contrario (Q1). | ✅ |
| V. Test-first | Los escenarios PRD «Pago pendiente» y «Conflicto de edición» son tests obligatorios (unidad, API y E2E). | ✅ |
| VI. Free tier | Presupuesto en research R7, sin dependencias nuevas. | ✅ |
| VII. PWA accesible | Previsualización y diff como regiones accesibles; axe en las pantallas nuevas. | ✅ |
| VIII. Simplicidad | Sin comprobantes ni notificaciones (Fases 4–5). Las devoluciones reutilizan el modelo de proyecciones como «gasto negativo». | ✅ |

**Re-check post-diseño**: ✅.

## Trazabilidad Gherkin PRD (§6.1) tras 003

| Escenario | Estado |
|---|---|
| Todos deben aceptar antes del primer gasto | ✅ 001 |
| Redondeo 10.00 / 3 | ✅ 001/002 |
| **Pago pendiente no afecta balances** | ✅ **003** de punta a punta (API + E2E) |
| Moneda congelada | ✅ 001 |
| **Conflicto de edición concurrente** | ✅ **003** (API + E2E) |
| Usuario sin acceso al comprobante privado | ✅ 002; los adjuntos llegan en la Fase 4 |

Con esto quedan cubiertos los 6 escenarios críticos, salvo la parte de adjuntos del último.

## Project Structure

```text
packages/finance-engine/src/
├── refunds.ts               # itemAdjustmentShares, itemRefundable, suggestRefund, itemChargesByMember, refundEffect (nuevo)
└── preview.ts               # balancesPreview (nuevo)

packages/contracts/src/api/
├── settlements.ts · refunds.ts · preview.ts   (nuevos)
└── expenses.ts              # quantity, UpdateExpenseBody, RestoreBody

apps/api/src/services/
├── settlements.ts           # create/confirm/reject/cancel (nuevo)
├── expenses.ts              # updateExpense, restoreExpense, guardas de previsualización
├── preview.ts               # previewExpenseChange (nuevo)
├── refunds.ts               # refundable, createRefund (nuevo)
└── projections.ts           # applyExpense con count opcional; deltas múltiples

apps/web/src/features/
├── settlements/             # SettlementsPanel, PaySettlementForm (nuevo)
├── expenses/                # EditExpensePage, ConflictDiff, ImpactPreview, RefundForm; Detail con editar, restaurar y devoluciones
└── balances/BalancesPanel.tsx  # botón «Pagar» en la vista simplificada

firebase/firestore.rules     # settlements, refunds
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `expectedLedgerRevision` + `PREVIEW_REQUIRED` | FR-014 exige confirmar tras ver el impacto y detectar cambios entre la vista previa y la confirmación. | Una previsualización solo en la UI no garantiza la confirmación ni detecta saldos obsoletos. |
| Devoluciones como subcolección del gasto | Heredan la visibilidad del gasto con una regla de una línea. | Una colección propia en el viaje obligaría a duplicar `viewerUids` y a mantenerlos sincronizados al editar. |
