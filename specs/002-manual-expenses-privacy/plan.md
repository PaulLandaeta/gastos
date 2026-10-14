# Implementation Plan: Gastos manuales, privacidad y dashboard (Fase 2)

**Branch**: `002-manual-expenses-privacy` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-manual-expenses-privacy/spec.md`

## Summary

La feature lleva a la interfaz el registro manual de gastos que en 001 solo existía en la API:
- **Registro**: reparto por total o por ítems, asignación en lote, facturas mixtas, ajustes, varios
  pagadores y periodo de servicio. La validación en vivo usa el mismo motor financiero en el
  navegador.
- **Organización**: categorías por viaje, lista y detalle del gasto, anulación con historial y
  aviso de posible duplicado.

La privacidad (RF-38) se aplica por documento:
- Cada gasto guarda `viewerUids` (pagadores, beneficiarios y autor).
- Las Security Rules solo dejan leer el gasto a esas personas o a quien tenga hoy el rol de
  creador o admin.
- La API usa la misma regla (`canViewExpense`).

El dashboard no recorre los gastos:
- Lee proyecciones incrementales: total público del viaje, totales por categoría (solo admin) y
  estadísticas por miembro.
- Estas proyecciones se actualizan en la misma transacción que crea o anula el gasto.
- Los filtros se calculan en el cliente sobre los gastos visibles del rango elegido.

## Technical Context

**Language/Version**: TypeScript 6 (strict); Node 24 (tooling) y workerd (API). Sin cambios
respecto a 001.

**Primary Dependencies**: las de 001. No se añade ninguna: el gráfico se hace con HTML/CSS
accesible.

**Storage**: Cloud Firestore (Spark):
- Gastos con schemaVersion 2.
- Nuevas colecciones: `categories`, `memberStats`, `projections/public` y
  `projections/categories`.
- Índices compuestos para lista, filtros, pestaña de personales y duplicados.

**Testing**: Vitest (motor, contratos y API en workerd contra el emulador),
`@firebase/rules-unit-testing` y Playwright con axe.

**Target Platform**: PWA mobile-first, probada en un ancho de 360 px. La API sigue en Workers Free.

**Project Type**: aplicación web (monorepo de 001).

**Performance Goals**:
- Dashboard sin filtros: 1 request (`GET /stats`) con ≤ 6 lecturas.
- Lista: páginas de 50.
- Primera página y totales en < 3 s con 1.000 gastos (SC-008).
- Cálculo del formulario en vivo: < 5 ms por cambio.
- CPU de la API por request: < 5 ms, medido como en 001.

**Constraints**:
- Solo un `array-contains` por consulta, así que los filtros de persona y pagador se aplican en
  memoria.
- Sin edición de gastos, por lo que `viewerUids` es inmutable.
- Límites del plan gratuito (research R9).

**Scale/Scope**: unas 4–10 personas por viaje y hasta 1.000 gastos. 5 pantallas nuevas: inicio
del viaje con accesos rápidos, formulario de gasto, lista con sus dos pestañas, detalle con
historial y categorías.

Sin NEEDS CLARIFICATION: las 5 aclaraciones están en la spec y el resto en [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | El mismo `computeExpense` en el cliente y en el servidor. `parseMoneyInput` trabaja con cadenas y enteros, sin flotantes. Invariante `sharedTotal + personalTotal = total`. Las proyecciones son reconstruibles y un test lo comprueba. | ✅ |
| II. Privacidad deny-by-default | La visibilidad se aplica por documento en Rules (`viewerUids` + rol en vivo) y en la API (`canViewExpense`). Los gastos ajenos no se listan. Los agregados por persona de otros solo los ve un admin. Cada fila de reglas tiene su test negativo. | ✅ |
| III. Escrituras solo en servidor | Gastos, categorías y proyecciones solo se escriben desde la API. El cliente solo lee. | ✅ |
| IV. Auditable, versionado, idempotente | La idempotencia se evalúa antes de los duplicados. Alta y anulación generan eventos de auditoría con historial consultable. Las categorías llevan versión. | ✅ |
| V. Test-first | Rules, API, contratos y E2E se escriben antes de implementar. El escenario Gherkin «comprobante privado» se cubre en Rules y API. | ✅ |
| VI. Free-tier first | Proyecciones incrementales y presupuesto por operación (research R9). Sin dependencias nuevas. | ✅ |
| VII. PWA mobile-first, accesible | Formulario a 360 px con barra de total fija. Gráfico accesible: barras con etiqueta y tabla. Pruebas axe en todas las pantallas nuevas. | ✅ |
| VIII. Simplicidad | Una categoría por gasto. Sin edición, restauración, adjuntos ni librería de gráficos. | ✅ |

**Re-check post-diseño**: ✅. La decisión Q2 (acceso al gasto completo) permite no separar
resumen y detalle en documentos distintos, lo que simplifica las reglas.

## Trazabilidad de escenarios Gherkin del PRD (§6.1)

| Escenario | Estado tras 002 |
|---|---|
| Todos deben aceptar antes del primer gasto | ✅ 001 |
| Redondeo exacto 10.00 / 3 | ✅ 001; en 002 también por la UI (E2E) |
| Pago pendiente no afecta balances | ✅ 001 (motor); la API de pagos llega en la Fase 3 |
| Moneda congelada | ✅ 001 |
| Conflicto de edición concurrente de un gasto | Diferido a la Fase 3 (edición) |
| Usuario sin acceso al comprobante privado | ✅ **002**: Rules y API sobre los datos del gasto. Los adjuntos llegan en la Fase 4. |

## Project Structure

### Documentation (this feature)

```text
specs/002-manual-expenses-privacy/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/http-api.md · contracts/access-rules.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (cambios sobre el monorepo de 001)

```text
packages/contracts/src/
├── money.ts                 # parseMoneyInput (nuevo)
├── categories.ts            # DEFAULT_CATEGORIES (nuevo)
└── api/expenses.ts, api/categories.ts, api/stats.ts   # esquemas v2 / nuevos

apps/api/src/
├── services/visibility.ts   # canViewExpense, canVoidExpense, viewerUids (nuevo)
├── services/expenses.ts     # alta v2: categoría, duplicados, proyecciones, memberStats
├── services/projections.ts  # public, categories, memberStats (nuevo)
├── services/categories.ts   # alta/edición + siembra de iniciales (nuevo)
├── services/stats.ts        # GET /stats (nuevo)
├── services/history.ts      # GET /expenses/{id}/history (nuevo)
└── routes/categories.ts, routes/stats.ts, routes/expenses.ts

apps/web/src/features/
├── expenses/                # ExpenseForm (+ ItemsEditor, AdjustmentsEditor, PayersEditor,
│                            #   TotalsBar), ExpenseListPage, ExpenseDetailPage, useExpenses
├── dashboard/               # DashboardPanel, CategoryChart, Filters
├── categories/              # CategoriesPage
└── trips/TripDetailPage.tsx # accesos rápidos (RF-25) + dashboard

apps/web/tests/unit/          # Vitest: expenseFormModel, dashboardModel (nuevo)
apps/web/vitest.config.ts     # (nuevo)

firebase/firestore.rules, firestore.indexes.json, tests/rules.test.ts
```

**Structure Decision**: se mantiene el monorepo de 001. La lógica de visibilidad vive en
`apps/api/src/services/visibility.ts` y se replica en las Rules; un test de paridad recorre la
misma matriz de casos contra las dos.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Tres proyecciones nuevas (`public`, `categories`, `memberStats`) | El dashboard tiene que costar O(1) lecturas con 1.000 gastos (SC-008, plan gratuito) y respetar la privacidad de Q3 y FR-026. | Recorrer todos los gastos en cada vista agota la cuota diaria y no puede ocultar los totales por persona. |
| Lógica de visibilidad duplicada en Rules y API | La constitution II exige aplicarla en ambas capas. | Servir los gastos solo por la API perdería la caché y las lecturas en vivo del SDK, y multiplicaría las peticiones a Workers. |
