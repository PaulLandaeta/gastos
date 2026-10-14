---

description: "Task list for 003-settlements-edits-refunds"
---

# Tasks: Liquidaciones, edición, restauración y devoluciones (Fase 3)

**Input**: `specs/003-settlements-edits-refunds/` (plan, spec, research, data-model, contracts, quickstart) · Base: 001 + 002 in `main`.

**Tests**: MANDATORY (Constitution V). Every test task is written and seen FAILING before its implementation.

**Stories**: US1 pagos · US2 edición con conflictos · US3 previsualización de impacto · US4 restauración · US5 devoluciones.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 [P] Add error codes `PREVIEW_REQUIRED` (409), `REFUND_EXCEEDS` (422), `REFUND_CONSTRAINT` (422) to `packages/contracts/src/errors.ts` and Spanish messages to `apps/web/src/components/ErrorMessage.tsx`
- [X] T002 [P] Add `quantity` (int ≥ 1, default 1) to `ExpenseItemBody`, plus `UpdateExpenseBody` (create body + `expectedVersion`, `expectedLedgerRevision?`), `RestoreExpenseBody` and `expectedLedgerRevision?` on `VoidExpenseBody` in `packages/contracts/src/api/expenses.ts`, with tests in `packages/contracts/tests/expenses-v3.test.ts`

---

## Phase 2: Foundational

### Tests first

- [X] T003 [P] Write engine tests for `itemAdjustmentShares`, `itemRefundable`, `suggestRefund`, `itemChargesByMember`, `refundEffect` (zero-sum, original view nets exactly, recipient as beneficiary, personal items, rotation determinism) and fast-check properties in `packages/finance-engine/tests/unit/refunds.test.ts` and `packages/finance-engine/tests/property/refunds.property.test.ts`
- [X] T004 [P] Write engine tests for `balancesPreview` (before/after/delta for every member, Σ delta = 0) in `packages/finance-engine/tests/unit/preview.test.ts`
- [X] T005 [P] Write projection tests: `applyExpense` with `{ count: 0 }` for refunds, multi-delta write (−old +new) equals `rebuildProjections` over the final state in `apps/api/tests/services/projections.unit.test.ts`
- [X] T006 [P] Add Rules tests for `settlements` (members read, strangers denied) and `expenses/{e}/refunds` (parent viewers and managers read; non-involved denied; no client writes) in `firebase/tests/rules.test.ts`

### Implementation

- [X] T007 [P] Implement `packages/finance-engine/src/refunds.ts` and export from `packages/finance-engine/src/index.ts` (makes T003 pass)
- [X] T008 [P] Implement `packages/finance-engine/src/preview.ts` (makes T004 pass)
- [X] T009 Extend `apps/api/src/services/projections.ts`: `applyExpense(p, e, sign, { count })`, `writeProjectionsDelta(tx, tripId, loaded, entries[])`, `rebuildProjections(expenses, refunds)` (makes T005 pass)
- [X] T010 Add Rules for `settlements` and `expenses/{e}/refunds` in `firebase/firestore.rules` (makes T006 pass)
- [X] T011 Write expense schemaVersion 3 (`items[].quantity`, `refundedByItem: {}`) in `createExpense` in `apps/api/src/services/expenses.ts`; keep reading v2 documents (quantity defaults to 1)

**Checkpoint**: engine, projections and Rules green.

---

## Phase 3: User Story 1 - Pagos (Priority: P1) 🎯 MVP

**Goal**: register, confirm, reject and cancel payments; only confirmed ones change balances.

**Independent Test**: PRD «Pago pendiente no afecta balances» end-to-end.

### Tests (MANDATORY) ⚠️

- [X] T012 [P] [US1] Write API tests in `apps/api/tests/routes/settlements.test.ts`: PRD scenario (debt 20.00, pending 10.00 keeps 20.00, confirmed → 10.00); reject with reason keeps balances; only receiver confirms/rejects; only emitter cancels; non-pending → `INVALID_TRANSITION`; self/zero → 422; non-member receiver → 422; closed trip → `TRIP_READ_ONLY`; idempotent create; concurrent double confirm applies once; `exceedsDebt` flag; `confirmedSettlementCount` increments; FR-008: a confirmed payment is immutable and an erroneous one is corrected by a payment in the opposite direction (receiver → emitter) that restores the previous balances once confirmed
- [X] T013 [P] [US1] Write E2E in `apps/web/tests/e2e/settlements.spec.ts`: PRD scenario through the UI, «Pagar» from the simplified view prefilled, reject with reason visible to the emitter, list filter by state

### Implementation

- [X] T014 [P] [US1] Add settlement schemas (`CreateSettlementBody`, `ResolveSettlementBody`, `SettlementDto`) in `packages/contracts/src/api/settlements.ts`
- [X] T015 [US1] Implement `createSettlement`, `confirmSettlement`, `rejectSettlement`, `cancelSettlement` in `apps/api/src/services/settlements.ts` and routes in `apps/api/src/routes/settlements.ts` (makes T012 pass)
- [X] T016 [P] [US1] Implement `SettlementsPanel` (live list with state filter, receiver actions Confirmar/Rechazar with optional reason, emitter Cancelar) and `PaySettlementForm` (receiver select, MoneyInput, note, prefill from query/state, exceeds-debt warning) in `apps/web/src/features/settlements/`
- [X] T017 [US1] Add «Pagar» to the user's own transfers in the simplified view in `apps/web/src/features/balances/BalancesPanel.tsx`, mount `SettlementsPanel` and route `/trips/:tripId/settlements/new` in `apps/web/src/features/trips/TripDetailPage.tsx` and `apps/web/src/app/router.tsx`; highlight pending payments to confirm on the trip home

**Checkpoint**: debts can be settled.

---

## Phase 4: User Story 2 - Edición con conflictos (Priority: P1)

**Goal**: edit expenses with optimistic versioning, visible diffs, recomputed visibility and history.

**Independent Test**: PRD «Conflicto de edición concurrente» (versión 4 → 5 / CONFLICT).

### Tests (MANDATORY) ⚠️

- [X] T018 [P] [US2] Write API tests in `apps/api/tests/routes/expenses.update.test.ts`: author/creator/admin edit; member forbidden (non-viewer 404); PRD concurrent scenario (exactly one 200 version+1, other `CONFLICT {currentVersion}`); seq preserved; ledger/projections equal rebuild after edit; viewerUids recomputed (removed beneficiary loses Rules read access, new one gains it); history `expense.update` with `changed` field names; voided expense or closed trip → rejected; inactive category rejected; engine validations
- [X] T019 [P] [US2] Write unit tests for `fromExpense(expense) → ExpenseDraft` round trip and `diffDraft(draft, current)` field list in `apps/web/tests/unit/expenseEdit.test.ts`
- [X] T020 [P] [US2] Write E2E in `apps/web/tests/e2e/expense-edit.spec.ts`: edit from detail; two pages edit the same expense → second sees «Otra persona modificó el gasto» with the differing fields and keeps its draft; non-author member has no «Editar»

### Implementation

- [X] T021 [US2] Implement `updateExpense` (permissions, version, refunds constraints placeholder, recompute with same seq, −old +new ledger/projections, viewerUids, audit diff) in `apps/api/src/services/expenses.ts` and `PUT` route in `apps/api/src/routes/expenses.ts` (makes T018 pass)
- [X] T022 [P] [US2] Implement `fromExpense` and `diffDraft` in `apps/web/src/features/expenses/expenseEditModel.ts` (makes T019 pass)
- [X] T023 [US2] Implement `EditExpensePage` (reuses `ExpenseForm`, sends `expectedVersion`, on `CONFLICT` shows `ConflictDiff` against the live current document with «Recargar con la versión actual» / «Mantener mi borrador») and route `/trips/:tripId/expenses/:expenseId/edit`; add «Editar» to `ExpenseDetailPage` for author/creator/admin; history shows «Editado (campos…)»; add «Cantidad» to `ItemsEditor`

**Checkpoint**: PRD conflict scenario passes.

---

## Phase 5: User Story 3 - Previsualización de impacto (Priority: P1)

**Goal**: mandatory balances preview when the trip has confirmed payments, guarded by ledger revision.

**Independent Test**: with a confirmed payment, editing/voiding/restoring shows before/after and only applies after confirmation.

### Tests (MANDATORY) ⚠️

- [X] T024 [P] [US3] Write API tests in `apps/api/tests/routes/preview.test.ts`: preview for edit/void/restore returns before/after/delta and `ledgerRevision`; non-viewer 404; with confirmed payments a mutation without `expectedLedgerRevision` → `PREVIEW_REQUIRED` with preview in details; stale revision → `CONFLICT`; without confirmed payments revision optional
- [X] T025 [P] [US3] Write E2E in `apps/web/tests/e2e/impact-preview.spec.ts`: after a confirmed payment, editing and voiding show «Impacto en saldos» and apply only after «Confirmar cambios»

### Implementation

- [X] T026 [P] [US3] Add preview schemas in `packages/contracts/src/api/preview.ts`
- [X] T027 [US3] Implement `previewExpenseChange` in `apps/api/src/services/preview.ts`, the `POST …/preview` route, and the `expectedLedgerRevision` guard (helper `assertPreviewAcknowledged`) applied in `updateExpense` and `voidExpense` in `apps/api/src/services/expenses.ts` (makes T024 pass)
- [X] T028 [US3] Implement `ImpactPreview` (accessible table before/after/delta by person, Confirmar/Cancelar) and wire it to edit and void flows (handle `PREVIEW_REQUIRED` by showing details and resending with the revision) in `apps/web/src/features/expenses/ImpactPreview.tsx`, `EditExpensePage.tsx`, `ExpenseDetailPage.tsx`

**Checkpoint**: FR-013/014 enforced server-side.

---

## Phase 6: User Story 4 - Restauración (Priority: P2)

### Tests (MANDATORY) ⚠️

- [X] T029 [P] [US4] Write API tests in `apps/api/tests/routes/expenses.restore.test.ts`: void+restore leaves ledger/projections identical; permissions like void; active expense → `INVALID_TRANSITION`; inactive category still restorable; duplicate warning applies (excluding itself); preview guard; history `expense.restore`
- [X] T030 [P] [US4] Write E2E in `apps/web/tests/e2e/expense-restore.spec.ts`: void then «Restaurar gasto» → balances back; history shows Creado, Anulado, Restaurado

### Implementation

- [X] T031 [US4] Implement `restoreExpense` and route `POST …/restore` in `apps/api/src/services/expenses.ts` and `apps/api/src/routes/expenses.ts` (makes T029 pass)
- [X] T032 [US4] Add «Restaurar gasto» (with preview flow and duplicate confirmation) to `apps/web/src/features/expenses/ExpenseDetailPage.tsx`

---

## Phase 7: User Story 5 - Devoluciones por ítem (Priority: P2)

### Tests (MANDATORY) ⚠️

- [X] T033 [P] [US5] Write API tests in `apps/api/tests/routes/refunds.test.ts`: quickstart example (3 × 10.00 Ana/Pedro, refund 1 unit received by Pedro → charges −5.00 each, ledger zero-sum, Pedro owes Ana 5.00); suggested amount includes proportional tax; `REFUND_EXCEEDS` with max quantity/amount; permissions (payer/beneficiary/author/creator/admin; non-involved 404); recipient must be member; voided expense rejects; void/restore of the parent removes/re-adds refund effects; edit cannot drop below refunded (`REFUND_CONSTRAINT`); projections equal rebuild; idempotent
- [X] T034 [P] [US5] Write E2E in `apps/web/tests/e2e/refunds.spec.ts`: register a partial refund from the item in the detail, suggested amount shown, max enforced, refunds listed in the item

### Implementation

- [X] T035 [P] [US5] Add refund schemas in `packages/contracts/src/api/refunds.ts`
- [X] T036 [US5] Implement `getRefundable`, `createRefund` in `apps/api/src/services/refunds.ts` with routes; apply refund effects on void/restore and `REFUND_CONSTRAINT` in `updateExpense` (makes T033 pass)
- [X] T037 [US5] Implement `RefundForm` (quantity or amount, suggested amount, recipient select, max shown) and the refunds list per item in `apps/web/src/features/expenses/RefundForm.tsx` and `ExpenseDetailPage.tsx`

**Checkpoint**: all stories complete.

---

## Phase 8: Polish

- [X] T038 [P] Extend `apps/web/tests/e2e/a11y.spec.ts` with settlements panel, edit page with conflict diff, impact preview and refund form at 360 px
- [X] T039 [P] Extend `apps/api/perf/cpu.perf.ts` with edit (−old +new) and refund effect; keep < 5 ms
- [X] T040 [P] Add a fast-check property over random sequences of create/edit/void/restore/refund/confirm-payment asserting Σ saldos = 0 and incremental == rebuild in `packages/finance-engine/tests/property/sequences.property.test.ts`
- [X] T041 [P] Security review recorded in `specs/003-settlements-edits-refunds/checklists/security.md`; update `README.md` features list and the 002 contract cross-reference
- [X] T042 Run full validation (lint, typecheck, unit, API ×3, Rules, perf, E2E) and the `quickstart.md` walkthrough; fix drift

---

## Dependencies & Execution Order

- Setup → Foundational → US1 (independent of US2–US5) · US2 → US3 (preview guards edit/void) → US4 (restore uses preview) · US5 after US2 (edit constraints) and US4 (void/restore of refunds).
- Polish last.

### Parallel Opportunities

- T001–T002; T003–T006; T007–T008; US1 tests T012–T013 with US2 tests T018–T020; T014, T016, T022, T026, T035 [P].

## Implementation Strategy

1. Foundational (engine + projections + Rules) → US1 (MVP: settle debts).
2. US2 + US3 (safe corrections) → US4 → US5 → Polish.

## Notes

- Commit per phase (no AI co-author trailers). Never weaken a test; amend spec/plan instead.
