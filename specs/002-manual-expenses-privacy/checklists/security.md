# Security Review: 002-manual-expenses-privacy

**Fecha**: 2026-10-13 · **Alcance**: Rules de gastos/categorías/proyecciones, endpoints nuevos (historial, stats,
categorías, duplicados), UI de detalle.
**Resultado**: sin hallazgos abiertos de severidad alta.

## Verificado

- [x] **Paridad API ↔ Rules** (`firebase/tests/visibility-parity.test.ts`): la misma matriz (pagador, beneficiario, autor,
      no involucrado, admin, creador) da el mismo resultado en `canViewExpense` y en las Security Rules.
- [x] **Escenario PRD «comprobante privado»**: Rules (get y list), API (`/history` → 404, `/void` → 404 para no
      involucrados) y UI (lista sin el gasto, enlace directo → «No encontrado») — `privacy.spec.ts`.
- [x] **Admin degradado** pierde el acceso al instante (rol leído en vivo en Rules y en cada transacción de la API).
- [x] **Listas**: un participante solo puede consultar con `viewerUids array-contains uid`; sin ese filtro → denegado.
- [x] **Duplicados**: `details.similar` solo si el usuario puede ver el gasto parecido; si no, aviso sin datos.
- [x] **Stats**: totales por persona de otros solo para creador/admin (FR-026); el gráfico de un participante usa solo
      sus gastos visibles (Q3); proyecciones y `memberStats` ilegibles por Rules.
- [x] **Historial**: `auditEvents` siguen ilegibles por Rules; `/history` filtra por `canViewExpense`.
- [x] **IDs en ruta**: `expenseId` y `categoryId` validados con `assertSafeId`.
- [x] **Escrituras**: gastos, categorías y proyecciones solo vía API (`allow write: if false`).

## Riesgos aceptados

- Quien puede ver un gasto ve todos sus ítems, incluidos los personales de otros (decisión Q2 de la spec).
- El total compartido del viaje es visible para todos (FR-023); con muy pocos participantes puede permitir inferir
  el importe de un gasto ajeno si es el único movimiento (decisión pendiente PRD §14.7, sin cambios).
- Recomendado antes de producción: `/security-review` sobre la rama completa.
