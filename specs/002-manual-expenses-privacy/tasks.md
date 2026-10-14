---

description: "Task list for 002-manual-expenses-privacy"
---

# Tasks: Gastos manuales, privacidad y dashboard (Fase 2)

**Input**: Design documents from `specs/002-manual-expenses-privacy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md,
contracts/access-rules.md, quickstart.md · Base: feature 001 (merged in `main`).

**Tests**: MANDATORY (Constitution Principle V). Every test task MUST be written and seen FAILING
before its implementation tasks.

**Organization**: by user story (spec.md US1–US7):
US1 registro simple · US2 factura por ítems/mixta/ajustes · US3 privacidad · US4 lista, detalle,
anulación e historial · US5 categorías · US6 dashboard, personales y filtros · US7 duplicados.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: user story label (US1…US7)

---

## Phase 1: Setup

- [X] T001 Add the composite indexes from data-model.md (expenses × viewerUids/transactionDate/createdAt, categoryId, personalBeneficiaryUids, status/transactionDate/totalMinor; auditEvents × entityId/timestamp) to `firebase/firestore.indexes.json`
- [X] T002 [P] Add the new error codes `POSSIBLE_DUPLICATE`, `CATEGORY_INACTIVE`, `DUPLICATE_CATEGORY` (409) to `packages/contracts/src/errors.ts` and their Spanish messages to `apps/web/src/components/ErrorMessage.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: money input parsing, expense v2 shape, default categories, visibility, projections
and the privacy Rules that every story relies on. ⚠️ No story work before this phase is complete.

### Tests first

- [X] T003 [P] Write tests for `parseMoneyInput(text, decimals, locale)` (USD "10", "10.5", "10,50" in es, "1.234,56" es, "1,234.56" en, JPY "1500" and rejecting "15.5", KWD 3 decimals, negatives/empty/garbage rejected, > MAX_SAFE_INTEGER rejected) in `packages/contracts/tests/money.test.ts`
- [X] T004 [P] Write tests for `CreateExpenseBody` v2 (categoryId required, notes ≤ 500, servicePeriod end ≥ start, confirmDuplicate optional) and `DEFAULT_CATEGORIES` (6 deterministic ids) in `packages/contracts/tests/expenses-v2.test.ts`
- [X] T005 [P] Write unit tests for `viewerUidsOf`, `canViewExpense`, `canVoidExpense` (payer, beneficiary, author, admin, creator, demoted admin, stranger, voided, closed trip) in `apps/api/tests/services/visibility.test.ts`
- [X] T006 [P] Write API tests: createTrip seeds the 6 default categories; expense v2 stores `categoryId`, `viewerUids`, `payerUids`, `beneficiaryUids`, `personalBeneficiaryUids`, `sharedTotalMinor + personalTotalMinor = totalMinor`, `chargesByMember`, `recordedAt`, `servicePeriod`, `schemaVersion: 2`; an inactive/unknown category → `CATEGORY_INACTIVE`; a `default-*` id on a trip without categories seeds them in the same transaction, in `apps/api/tests/routes/expenses.v2.test.ts`
- [X] T007 [P] Write API tests for projections: create/void keep `projections/public`, `projections/categories` and `memberStats/{uid}` (for every viewer) equal to `rebuildProjections` over the active expenses, in `apps/api/tests/routes/projections.test.ts`
- [X] T008 [P] Add Rules tests per contracts/access-rules.md (002): expenses get/list by viewer vs non-involved vs manager vs demoted admin; list without `array-contains` denied for members; categories readable by members; every `projections/*`, `memberStats` and `auditEvents` document denied to clients (dashboard data only via `GET /stats`), in `firebase/tests/rules.test.ts`

### Implementation

- [X] T009 [P] Implement `parseMoneyInput` (string arithmetic only, locale-aware decimal separator) in `packages/contracts/src/money.ts` and export it (makes T003 pass)
- [X] T010 [P] Implement `DEFAULT_CATEGORIES` in `packages/contracts/src/categories.ts` and extend `CreateExpenseBody`/`ExpenseSummary` (v2 fields, `chargesByMember` in the response) in `packages/contracts/src/api/expenses.ts` (makes T004 pass)
- [X] T011 [P] Implement `viewerUidsOf`, `canViewExpense`, `canVoidExpense` in `apps/api/src/services/visibility.ts` (makes T005 pass)
- [X] T012 Seed default categories in `createTrip` and add `ensureCategory(tx, tripId, categoryId)` (lazy seeding for `default-*`, `CATEGORY_INACTIVE` otherwise) in `apps/api/src/services/categories.ts` and `apps/api/src/services/trips.ts`
- [X] T013 Implement projection helpers `readProjections`/`applyExpenseToProjections(sign)` and the pure `rebuildProjections(activeExpenses)` (Constitution I: projections are rebuildable) for `projections/public`, `projections/categories` and `memberStats/{uid}` in `apps/api/src/services/projections.ts`
- [X] T014 Extend `createExpense`/`voidExpense` to expense v2 (category check, derived uid arrays, shared/personal totals, servicePeriod, notes, projections on create and void, `canVoidExpense`) in `apps/api/src/services/expenses.ts` (makes T006, T007 pass)
- [X] T015 Add Rules `isManager(tripId)` and the expenses and categories matches (projections and memberStats stay denied) in `firebase/firestore.rules` (makes T008 pass)
- [X] T016 [P] Implement web hooks `useCategories`, `useExpensesPage` (paginated live query: `viewerUids array-contains` for members, unfiltered for managers, 50 per page) and `useMyRole` in `apps/web/src/features/expenses/useExpenses.ts`
- [X] T017 [P] Implement accessible `MoneyInput` (inputmode decimal, uses `parseMoneyInput`, shows the trip currency, error state) in `apps/web/src/components/MoneyInput.tsx`

**Checkpoint**: `pnpm test && pnpm test:rules` green; expenses v2 written by the API, private by Rules.

---

## Phase 3: User Story 1 - Registrar un gasto compartido simple (Priority: P1) 🎯 MVP

**Goal**: quick access + "total" mode form with equal split and a single payer, live totals.

**Independent Test**: Ana registers USD 10.00 equal among 3 from the trip home in < 30 s; balances
show +6.66/−3.33/−3.33.

### Tests for User Story 1 (MANDATORY - Test-First) ⚠️

- [X] T018 [P] [US1] Write E2E (also logs the automated flow duration as a lower bound for SC-001): trip home shows «Registro manual» enabled and «Escanear factura» disabled («Próximamente»); pending/closed trips hide registration with a reason; Ana registers «Cena» USD 10.00 equal among 3 and sees the balances; a date outside the trip range is accepted, in `apps/web/tests/e2e/expense-simple.spec.ts`
- [X] T019 [P] [US1] Write component-level unit tests for the form state → `ExpenseInput` mapping (total mode, equal split, default payer = me, provisional seq) in `apps/web/tests/unit/expenseFormModel.test.ts` (add Vitest to `apps/web` with `vitest.config.ts`)

### Implementation for User Story 1

- [X] T020 [P] [US1] Implement the pure form model (`ExpenseDraft` → `CreateExpenseBody` + `computeExpense` preview, difference, missing beneficiaries) in `apps/web/src/features/expenses/expenseFormModel.ts`
- [X] T021 [US1] Implement `ExpenseForm` basic section (description, MoneyInput total, category select defaulting to the last one used (stored in localStorage per user and trip, fallback «Otros»), transaction date, optional service period, beneficiaries chips) and sticky `TotalsBar` (currency, total, difference, Save disabled until balanced) in `apps/web/src/features/expenses/ExpenseForm.tsx` and `apps/web/src/features/expenses/TotalsBar.tsx`
- [X] T022 [US1] Implement `NewExpensePage` (idempotency key per draft, POST, success confirmation showing the definitive per-person charges returned by the API (SC-003), keeps data on error) and route `/trips/:tripId/expenses/new` in `apps/web/src/features/expenses/NewExpensePage.tsx` and `apps/web/src/app/router.tsx`
- [X] T023 [US1] Add quick-access buttons (RF-25) and registration availability messages to `apps/web/src/features/trips/TripDetailPage.tsx` via `apps/web/src/features/trips/QuickActions.tsx`

**Checkpoint**: MVP — a simple shared expense can be registered from the UI.

---

## Phase 4: User Story 2 - Factura por ítems, mixta y con ajustes (Priority: P1)

**Goal**: items mode with bulk assignment, per-item modes, personal items, adjustments and multiple payers.

**Independent Test**: the 4-item mixed invoice of quickstart step 3 cannot be saved until balanced
and, once saved, per-person charges equal the engine preview.

### Tests for User Story 2 (MANDATORY - Test-First) ⚠️

- [X] T024 [P] [US2] Extend form-model unit tests: items mode, bulk assignment then individual fixed override, percent 99.99 % blocked, personal item single beneficiary, 150 items with bulk assignment recomputed in < 50 ms, item discount + general discount + proportional tax + equal tip + manual adjustment, two payers mismatch → difference, preview equals `computeExpense` in `apps/web/tests/unit/expenseFormModel.test.ts`
- [X] T025 [P] [US2] Write E2E (logs flow duration for SC-002) for the mixed invoice of quickstart step 3 (bulk assign, personal item, tax, two payers; blocked until balanced; saved charges shown) and a 3-day car rental with service period, in `apps/web/tests/e2e/expense-items.spec.ts`

### Implementation for User Story 2

- [X] T026 [US2] Extend the form model with items, selection, bulk assign, allocation modes, adjustments and payers in `apps/web/src/features/expenses/expenseFormModel.ts`
- [X] T027 [P] [US2] Implement `ItemsEditor` (add/remove items, MoneyInput gross/discount, shared/personal toggle, multi-select + «Asignar a…» bulk action, per-item mode equal/fixed/percent, highlight items without beneficiaries) in `apps/web/src/features/expenses/ItemsEditor.tsx`
- [X] T028 [P] [US2] Implement `AdjustmentsEditor` (general discount, tax, tip; proportional/equal/manual with per-person amounts) in `apps/web/src/features/expenses/AdjustmentsEditor.tsx`
- [X] T029 [P] [US2] Implement `PayersEditor` (one or several trip participants, amounts, «pagó todo» shortcut) in `apps/web/src/features/expenses/PayersEditor.tsx`
- [X] T030 [US2] Wire the mode toggle (total/items), the three editors and a per-person preview of charges (shared/personal) into `apps/web/src/features/expenses/ExpenseForm.tsx`

**Checkpoint**: complex invoices balance to the cent from the UI (SC-003).

---

## Phase 5: User Story 3 - Privacidad del detalle de gastos (Priority: P1)

**Goal**: non-involved participants never get expense detail through any channel; everyone sees balances and the public total.

**Independent Test**: Juan cannot read Ana/Pedro's expense via UI, direct link or direct data access, and sees balances.

### Tests for User Story 3 (MANDATORY - Test-First) ⚠️

- [X] T031 [P] [US3] Write a parity test running the same visibility matrix against `canViewExpense` and against the Rules emulator in `firebase/tests/visibility-parity.test.ts`
- [X] T032 [P] [US3] Write E2E for PRD scenario «Usuario sin acceso al comprobante privado»: Juan's list omits the expense, a direct URL shows «No encontrado», balances and the public total are visible; a personal expense of Ana is absent from Pedro's views; Pedro promoted to admin sees it and loses it again when demoted, in `apps/web/tests/e2e/privacy.spec.ts`

### Implementation for User Story 3

- [X] T033 [US3] Implement `ExpenseDetailPage` access handling (permission-denied or missing → `NotFound`, no data rendered) and route `/trips/:tripId/expenses/:expenseId` in `apps/web/src/features/expenses/ExpenseDetailPage.tsx` and `apps/web/src/app/router.tsx`
- [X] T034 [US3] Ensure every client query in `apps/web/src/features/expenses/useExpenses.ts` uses `viewerUids array-contains` unless the live role is creator/admin, re-subscribing when the role changes

**Checkpoint**: PRD privacy scenario passes in Rules, API and UI (SC-004).

---

## Phase 6: User Story 4 - Lista, detalle, anulación e historial (Priority: P2)

**Goal**: list visible expenses, show detail with per-person split, void with confirmation, history.

**Independent Test**: voiding from detail updates balances, marks the expense and history shows create + void.

### Tests for User Story 4 (MANDATORY - Test-First) ⚠️

- [X] T035 [P] [US4] Write API tests for `GET /v1/trips/{t}/expenses/{e}/history` (viewer gets create/void events with actor and timestamp; non-involved → 404; manager → 200) in `apps/api/tests/routes/history.test.ts`
- [X] T036 [P] [US4] Write E2E: list shows date/description/category/total/payers and voided badge; author voids with confirmation; non-author member has no «Anular»; history lists create and void, in `apps/web/tests/e2e/expense-list-void.spec.ts`

### Implementation for User Story 4

- [X] T037 [US4] Implement `getExpenseHistory` service and route in `apps/api/src/services/history.ts` and `apps/api/src/routes/expenses.ts`
- [X] T038 [P] [US4] Implement `ExpenseListPage` (tabs «Compartidos»/«Personales», 50-per-page «Cargar más», voided badge, link to detail) and route `/trips/:tripId/expenses` in `apps/web/src/features/expenses/ExpenseListPage.tsx`
- [X] T039 [US4] Complete `ExpenseDetailPage` (items, adjustments, payers, per-person shared/personal charges, service period, author, notes, «Anular» with inline confirmation for author/creator/admin, history section via API) in `apps/web/src/features/expenses/ExpenseDetailPage.tsx`

**Checkpoint**: expenses can be reviewed and voided from the UI.

---

## Phase 7: User Story 5 - Categorías del viaje (Priority: P2)

**Goal**: default categories plus custom ones managed by creator/admin; inactive ones not offered.

**Independent Test**: admin creates «Excursiones», uses it, it appears in filters; member cannot create; deactivated category disappears from the form.

### Tests for User Story 5 (MANDATORY - Test-First) ⚠️

- [X] T040 [P] [US5] Write API tests for `POST/PATCH /v1/trips/{t}/categories` (creator/admin only, unique name case-insensitive → `DUPLICATE_CATEGORY`, color format, deactivate/reactivate, stale version → `CONFLICT`, closed trip → `TRIP_READ_ONLY`) in `apps/api/tests/routes/categories.test.ts`
- [X] T041 [P] [US5] Write E2E: admin creates and deactivates categories; member sees no management controls; inactive category not offered in the form, in `apps/web/tests/e2e/categories.spec.ts`

### Implementation for User Story 5

- [X] T042 [P] [US5] Add `CreateCategoryBody`/`UpdateCategoryBody` schemas in `packages/contracts/src/api/categories.ts`
- [X] T043 [US5] Implement `createCategory`/`updateCategory` services and routes in `apps/api/src/services/categories.ts` and `apps/api/src/routes/categories.ts`
- [X] T044 [US5] Implement `CategoriesPage` (list with color, create form, activate/deactivate for managers) and route `/trips/:tripId/categories` in `apps/web/src/features/categories/CategoriesPage.tsx`

**Checkpoint**: categories manageable; form offers only active ones.

---

## Phase 8: User Story 6 - Dashboard, gastos personales y filtros (Priority: P2)

**Goal**: dashboard with public shared total, own stats, debts and category chart (visible scope), personal tab, filters.

**Independent Test**: Ana's dashboard shows shared, personal and global (= shared + personal); filters make list, totals and chart consistent.

### Tests for User Story 6 (MANDATORY - Test-First) ⚠️

- [X] T045 [P] [US6] Write API tests for `GET /v1/trips/{t}/stats` (public total for all; `me` stats; `byCategory` = visible scope for members and trip-wide for managers; `members` only for managers; non-member 404) in `apps/api/tests/routes/stats.test.ts`
- [X] T046 [P] [US6] Write unit tests for client-side filtering and aggregation (date range, category, person, payer; totals = Σ visible filtered; chart sums to total) in `apps/web/tests/unit/dashboardModel.test.ts`
- [X] T047 [P] [US6] Write E2E: dashboard figures for quickstart steps 2–5; personal tab; filter by Comida + date range, in `apps/web/tests/e2e/dashboard.spec.ts`

### Implementation for User Story 6

- [X] T048 [P] [US6] Add `StatsResponse` schema in `packages/contracts/src/api/stats.ts`
- [X] T049 [US6] Implement `getStats` service and route in `apps/api/src/services/stats.ts` and `apps/api/src/routes/stats.ts`
- [X] T050 [P] [US6] Implement the pure `dashboardModel` (filters + aggregation over visible expenses) in `apps/web/src/features/dashboard/dashboardModel.ts`
- [X] T051 [P] [US6] Implement accessible `CategoryChart` (horizontal bars with labels + visually hidden table) in `apps/web/src/features/dashboard/CategoryChart.tsx`
- [X] T052 [US6] Implement `DashboardPanel` (stats cards: shared total, contributed, shared consumed, personal, global, balance; debts summary; chart; `Filters` component switching to client-side aggregation when filters are active) in `apps/web/src/features/dashboard/DashboardPanel.tsx` and `apps/web/src/features/dashboard/Filters.tsx`, and mount it in `TripDetailPage`
- [X] T053 [US6] Implement the «Personales» tab stats header in `apps/web/src/features/expenses/ExpenseListPage.tsx`

**Checkpoint**: dashboard and filters consistent with visible data (SC-005).

---

## Phase 9: User Story 7 - Aviso de posible duplicado (Priority: P3)

**Goal**: warn on probable duplicates without blocking; exact retries create one expense silently.

**Independent Test**: two USD 45.00 same-day same-payer expenses → warning; confirm saves; double tap saves once.

### Tests for User Story 7 (MANDATORY - Test-First) ⚠️

- [X] T054 [P] [US7] Write API tests: `POSSIBLE_DUPLICATE` with `details.similar` when visible and empty details when not; `confirmDuplicate: true` saves and sets `duplicateConfirmed`; same idempotency key replays without warning; different date/total/payers → no warning; voided expenses ignored, in `apps/api/tests/routes/duplicates.test.ts`
- [X] T055 [P] [US7] Write E2E: duplicate warning dialog with Cancel (form preserved) and Confirm (saved); double click on Save creates one expense, in `apps/web/tests/e2e/duplicates.spec.ts`

### Implementation for User Story 7

- [X] T056 [US7] Implement duplicate detection after idempotency in `apps/api/src/services/expenses.ts` (query by status/transactionDate/totalMinor, payer intersection, visibility-aware details)
- [X] T057 [US7] Implement the duplicate warning (non-modal accessible alert region with similar expense, «Cancelar» / «Guardar de todos modos» resending with `confirmDuplicate`) and disable Save while pending in `apps/web/src/features/expenses/NewExpensePage.tsx`

**Checkpoint**: all user stories complete.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T058 [P] Extend `apps/web/tests/e2e/a11y.spec.ts` with the new screens (form with errors, list, detail, dashboard, categories) at 360 px width
- [X] T059 [P] Extend `apps/api/perf/cpu.perf.ts` with expense v2 + projections for 4 viewers; keep total < 5 ms
- [X] T060 [P] Security review of new Rules and endpoints (visibility parity, no leakage in duplicate details/history/stats) recorded in `specs/002-manual-expenses-privacy/checklists/security.md`
- [X] T061 Update `specs/001-finance-engine-trips/contracts/http-api.md` cross-reference and root `README.md` features list
- [X] T062 Add a volume check (SC-008): seed 1.000 expenses in the emulator and assert the first list page and the dashboard render in < 3 s, in `apps/web/tests/e2e/volume.spec.ts` (seeding helper `apps/web/tests/e2e/seed.ts`)
- [X] T063 Run the `quickstart.md` walkthrough (E2E + API script) and fix drift

---

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2 (same form files) · US3 needs Foundational (Rules) and the detail route from US1/US4 can be created there first.
- US4 depends on US3 (detail access handling). US5 independent after Foundational (form only reads categories).
- US6 depends on Foundational projections; its E2E uses expenses from US1/US2. US7 depends on US1 (NewExpensePage).
- Polish after all stories.

### Parallel Opportunities

- Foundational tests T003–T008 in parallel; T009–T011, T016–T017 in parallel.
- After US1: US3, US5 and the API halves of US4/US6/US7 (T035, T040, T045, T054) can proceed in parallel.
- Editors T027–T029 in parallel.

## Parallel Example: Foundational

```bash
Task: "T003 parseMoneyInput tests"   Task: "T005 visibility tests"
Task: "T006 expense v2 API tests"     Task: "T008 Rules tests"
```

## Implementation Strategy

1. Phase 1–2 (privacy-safe data layer) → validate with Rules + API tests.
2. US1 (MVP: simple registration from UI) → demo.
3. US2 (invoices) and US3 (privacy E2E) → core value complete.
4. US4, US5, US6, US7 → polish → quickstart walkthrough.

## Notes

- Commit after each phase (no AI co-author trailers, per constitution).
- Never weaken a test to make it pass; amend the spec/plan instead.
