# Security Review: 003-settlements-edits-refunds

**Fecha**: 2026-10-13 · **Alcance**: pagos, edición, previsualización, restauración y devoluciones.
**Resultado**: sin hallazgos abiertos de severidad alta.

## Verificado

- [x] **Pagos**: solo el receptor confirma/rechaza y solo el emisor cancela (403 a terceros); estados finales
      inmutables (`INVALID_TRANSITION`); doble confirmación concurrente aplica una vez; viaje cerrado → `TRIP_READ_ONLY`;
      sin escrituras desde cliente (Rules). Los pagos son legibles por todos los miembros (grafo público, RF-39).
- [x] **Edición**: autor/creador/admin; no involucrados → 404 (sin fuga de existencia); `expectedVersion` → `CONFLICT`;
      `viewerUids` recalculado y verificado con lectura real por Rules (el beneficiario retirado pierde acceso).
- [x] **Previsualización**: solo quien puede ver el gasto (404 si no); la confirmación obligatoria se aplica en el
      servidor (`PREVIEW_REQUIRED`) y detecta saldos obsoletos (`CONFLICT`), no solo en la UI.
- [x] **Devoluciones**: heredan la visibilidad del gasto (Rules con `get()` del padre + `canViewExpense`); límites de
      cantidad e importe validados en transacción; receptor debe ser miembro; idempotentes.
- [x] **Historial**: los cambios de edición solo listan nombres de campos (sin importes por ítem).
- [x] **IDs en ruta**: `settlementId` y `expenseId` validados con `assertSafeId`.

## Riesgos aceptados

- Cualquier miembro ve todos los pagos entre participantes (decisión de producto: forman parte de las deudas visibles).
- Un pago confirmado por error solo se corrige con un pago contrario (Q1); no hay reversión administrativa.
