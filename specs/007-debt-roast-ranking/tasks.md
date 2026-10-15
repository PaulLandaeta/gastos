# Tasks: Ranking de deudores en tono de broma (modo picante)

**Input**: Design documents from `specs/007-debt-roast-ranking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, quickstart.md

**Tests**: obligatorios (constitution, Principio V — test-first). Cada test se escribe antes que su implementación y
debe fallar primero.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1 ranking · US2 «zorra de quién» · US3 modo picante

---

## Phase 1: Setup

- [ ] T001 [P] Añadir `spicyMode: z.boolean().optional()` a `Trip` en packages/contracts/src/domain.ts y a `UpdateTripBody` en packages/contracts/src/api/trips.ts, incluyéndolo en el `refine` de «Nothing to update»; tests en packages/contracts/tests/roast.test.ts (acepta `{expectedVersion, spicyMode: true}`, rechaza `spicyMode: 'si'` y el cuerpo solo con `expectedVersion`)

---

## Phase 2: Foundational

- [ ] T002 Crear el esqueleto de packages/finance-engine/src/roast.ts con los tipos `RoastTier` (`'top' | 'golfa' | 'senorita' | 'macho'`), `RoastEntry` (`uid`, `netMinor`, `debtMinor`, `tier`, `owes`, `mainOwnerUid`) y la firma `roastRanking(netByMember, transfers, members)` según contracts/http-api.md; exportarlos en packages/finance-engine/src/index.ts

**Checkpoint**: contrato y tipos listos; las historias pueden empezar.

---

## Phase 3: User Story 1 — Ver el ranking del grupo (P1) 🎯 MVP

**Goal**: etiquetas por saldo neto con frase de burla (FR-005–FR-009, FR-017, FR-018).

**Independent Test**: con saldos Beto −120, Carla −70, Dani −15, Ana +150, Eva +55 el ranking da top/golfa/señorita/macho/macho y las frases con importes exactos.

### Tests (primero, deben fallar)

- [ ] T003 [P] [US1] Ejemplos en packages/finance-engine/tests/unit/roast.test.ts: escenario US1-1 (etiquetas y orden), empate en la deuda máxima resuelto por `joinOrder` (US1-2), deuda exactamente 50 % → `senorita` (US1-3), todo saldado → todos `macho` y sin `top` (US1-4), un solo deudor, deuda de 1 unidad menor, uid ausente de `members` al final, importe no entero → `EngineError`
- [ ] T004 [P] [US1] Propiedades fast-check en packages/finance-engine/tests/property/roast.property.test.ts sobre ledgers generados (reutilizar los generadores de tests/property): una entrada por miembro, exactamente un `top` si hay algún saldo negativo y ninguno si no, `macho ⇔ netMinor ≥ 0`, `golfa ⇔ 2·debt > maxDebt` (salvo el top), orden de la lista (deuda desc, luego `memberRanking`) y determinismo ante permutaciones de la entrada
- [ ] T005 [P] [US1] Tests de frases en apps/web/tests/unit/roastCopy.test.ts: etiqueta y frase de cada tier con nombre, importe formateado en la moneda del viaje y dueño; `macho` sin importe; dueño ausente → frase sin «a {dueño}»

### Implementation

- [ ] T006 [US1] Implementar la asignación de etiquetas, `debtMinor` y el orden en packages/finance-engine/src/roast.ts (regla R5 de research.md: `2 * debt > maxDebt` en enteros, desempate `memberRanking`, uids desconocidos al final por uid, `assertSafeMinor` en cada importe) hasta pasar T003–T004
- [ ] T007 [P] [US1] Crear apps/web/src/features/roast/roastCopy.ts con `ROAST_LABELS` y `roastSentence(entry, name, currency)` según la tabla de data-model.md, usando `formatMoney` de apps/web/src/lib/format.ts, hasta pasar T005
- [ ] T008 [US1] Crear apps/web/src/features/roast/RoastPanel.tsx: sección «Ranking del grupo» (`aria-labelledby`), consulta `['balances', trip.id, view, trip.version]` con `GET /trips/:id/balances?view=` y `meta: { persist: true }` igual que apps/web/src/features/balances/BalancesPanel.tsx, `roastRanking` con los miembros (`uid`, `joinOrder`) y una lista con etiqueta en texto (no solo color/emoji), nombre y frase; nombres de miembros como en BalancesPanel (los eliminados ya traen «Participante eliminado N»); `Spinner` y `ErrorMessage` para carga y error
- [ ] T009 [US1] Montar `RoastPanel` en apps/web/src/features/trips/TripDetailPage.tsx debajo de `BalancesPanel`, solo si `trip.spicyMode === true` y `trip.status !== 'pending'`

**Checkpoint**: activando `spicyMode` a mano en el emulador, cualquier miembro ve el ranking.

---

## Phase 4: User Story 2 — De quién es la zorra cada uno (P1)

**Goal**: relaciones «X es la zorra de Y» en vista directa y transitiva con dueño principal (FR-010–FR-013).

**Independent Test**: A debe 30 a B y B debe 30 a C → directa A→B y B→C; transitiva A→C; etiquetas iguales en ambas vistas.

### Tests (primero, deben fallar)

- [ ] T010 [P] [US2] Añadir a packages/finance-engine/tests/unit/roast.test.ts los escenarios US2-1/2/3: cadena A→B→C con `originalDebts` (directa) y `simplifiedDebts` (transitiva), varios acreedores ordenados por importe con empate por `joinOrder`, `mainOwnerUid` = primero de `owes` o `null`, y un `macho` que en la vista directa sigue debiendo a alguien (caso límite)
- [ ] T011 [P] [US2] Añadir a packages/finance-engine/tests/property/roast.property.test.ts: para `originalDebts` y `simplifiedDebts` del mismo ledger, `Σ owes(uid) − Σ recibido(uid) = −netMinor` para todo miembro y los `tier` coinciden entre ambas vistas (FR-013, SC-002)

### Implementation

- [ ] T012 [US2] Implementar `owes` y `mainOwnerUid` en packages/finance-engine/src/roast.ts a partir de `transfers` (importe desc, desempate `memberRanking`) hasta pasar T010–T011
- [ ] T013 [US2] En apps/web/src/features/roast/RoastPanel.tsx añadir el interruptor «Directa / Transitiva» (`role="group"`, botones con `aria-pressed`, por defecto Transitiva = `simplified`) y, por cada deudor, «X es la zorra de Y (importe)» para cada acreedor con «dueño principal» destacado en texto

**Checkpoint**: US1 + US2 completas con el ajuste puesto a mano.

---

## Phase 5: User Story 3 — Activar o desactivar el modo picante (P2)

**Goal**: ajuste por viaje, apagado por defecto, solo creador/administrador, auditado (FR-001–FR-004).

**Independent Test**: viaje nuevo sin ranking; el creador lo activa y un participante lo ve; un participante recibe 403; al desactivarlo desaparece.

### Tests (primero, deben fallar)

- [ ] T014 [P] [US3] Añadir a apps/api/tests/routes/trips.update.test.ts: viaje nuevo sin `spicyMode` (o `false`); creador y administrador ponen `spicyMode: true` → 200, `version` + 1 y auditoría `trip.update` con `diff.spicyMode === true`; participante → 403 `FORBIDDEN`; viaje archivado → 409 `TRIP_READ_ONLY`; `expectedVersion` desfasada → 409 `CONFLICT`; desactivar → `spicyMode: false`
- [ ] T015 [P] [US3] Crear apps/web/tests/e2e/roast.spec.ts (helpers de los E2E existentes en apps/web/tests/e2e): creadora y participante en un viaje con gastos; sin modo picante no hay «Ranking del grupo»; la creadora lo activa; el participante ve las etiquetas y cambia Directa/Transitiva; el participante no ve el interruptor; la creadora lo desactiva y desaparece; axe sin violaciones en la tarjeta

### Implementation

- [ ] T016 [US3] En apps/api/src/services/trips.ts, `updateTrip` aplica `body.spicyMode` al `patch` (el rol, `assertMutable`, la versión y la auditoría ya existen) y el tipo `TripData` en apps/api/src/services/tripRepo.ts incluye `spicyMode?: boolean`, hasta pasar T014
- [ ] T017 [US3] Crear apps/web/src/features/roast/SpicyModeToggle.tsx: interruptor accesible «Modo picante» (botón con `aria-pressed` y texto de estado) que hace `PATCH /trips/:id` con `{ expectedVersion: trip.version, spicyMode }`, envuelto en `RequiresOnline`, con `ErrorMessage` para 403/409; mostrarlo en apps/web/src/features/trips/TripDetailPage.tsx solo a creador/administrador con el viaje `pending` o `active`, hasta pasar T015

**Checkpoint**: las tres historias funcionan de punta a punta.

---

## Phase 6: Polish

- [ ] T018 [P] Añadir el modo picante a docs/pilot-guide.md (cómo activarlo y qué probar) y una fila RF-57 en docs/launch-checklist.md
- [ ] T019 Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm --filter finance-engine perf` y `pnpm --filter web test:e2e`; corregir lo que falle
- [ ] T020 Recorrer specs/007-debt-roast-ranking/quickstart.md en local y marcar las tareas completadas

---

## Dependencies & Execution Order

- **Setup (T001)** y **Foundational (T002)** antes de todo.
- **US1 (T003–T009)** primero: crea el motor y la tarjeta.
- **US2 (T010–T013)** depende de US1 (mismo archivo `roast.ts` y `RoastPanel.tsx`).
- **US3 (T014–T017)**: la parte de API (T014, T016) solo depende de T001 y puede ir en paralelo con US1/US2; la parte web (T015, T017) depende de T009.
- **Polish** al final.

### Parallel Opportunities

- T001 ∥ T002.
- US1: T003 ∥ T004 ∥ T005; después T006 ∥ T007.
- US2: T010 ∥ T011.
- US3: T014 ∥ T015; T014 + T016 se pueden hacer mientras se trabaja US1.

## Implementation Strategy

1. **MVP**: T001–T009 (ranking visible con el ajuste puesto a mano en el emulador).
2. Añadir US2 (relaciones y transitividad).
3. Añadir US3 (interruptor para gestores) → listo para desplegar.
4. Polish y PR.
