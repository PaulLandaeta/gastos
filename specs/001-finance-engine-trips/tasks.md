---

description: "Task list for 001-finance-engine-trips"
---

# Tasks: Motor financiero + identidad y viajes (Fase 0–1)

**Input**: Design documents from `specs/001-finance-engine-trips/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md,
contracts/access-rules.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle V, Test-First). Every test task MUST be written
and seen FAILING before its implementation tasks start.

**Organization**: Tasks are grouped by user story (spec.md US1–US5) so each story can be
implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 motor financiero · US2 login Google · US3 viajes e invitaciones ·
  US4 roles · US5 ciclo de vida, bloqueos, gastos de servicio y saldos

## Path Conventions

Monorepo pnpm (plan.md): `packages/finance-engine/`, `packages/contracts/`, `apps/api/`,
`apps/web/`, `firebase/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo, toolchain and emulator configuration

- [X] T001 Create root workspace files `package.json` (scripts: `lint`, `typecheck`, `test`, `test:rules`, `emulators`), `pnpm-workspace.yaml` (apps/*, packages/*), `.gitignore` (node_modules, dist, .dev.vars, .env.local, coverage, firebase-debug.log) and `.nvmrc` (24)
- [X] T002 Create `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target ES2023`, `moduleResolution bundler`
- [X] T003 [P] Configure ESLint flat config + Prettier at repo root in `eslint.config.js` and `.prettierrc` (rule: forbid `parseFloat`/`toFixed` in `packages/finance-engine/src/**`)
- [X] T004 [P] Scaffold `packages/finance-engine/` (`package.json`, `tsconfig.json`, `vitest.config.ts` with v8 coverage threshold 95 % lines, deps: `vitest`, `fast-check`)
- [X] T005 [P] Scaffold `packages/contracts/` (`package.json`, `tsconfig.json`, dep: `zod@4`) exporting from `packages/contracts/src/index.ts`
- [X] T006 [P] Scaffold `apps/api/` (`package.json`, `tsconfig.json`, `wrangler.jsonc` with `compatibility_date` 2026-10-01, `vitest.config.ts` using `@cloudflare/vitest-pool-workers`, deps: `hono@4`, `jose@6`, `zod@4`, workspace deps) and `apps/api/.dev.vars.example` (`ENVIRONMENT=emulator`, `FIREBASE_PROJECT_ID=demo-gastos`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`)
- [X] T007 [P] Scaffold `apps/web/` with Vite 8 + React 19 + TS (`package.json`, `vite.config.ts` with `vite-plugin-pwa` manifest only, Tailwind CSS 4, `index.html`, `apps/web/.env.example` with `VITE_FIREBASE_*`, `VITE_API_URL`, `VITE_USE_EMULATORS=true`)
- [X] T008 [P] Create `firebase.json` (emulators: auth 9099, firestore 8080, ui 4000; firestore rules `firebase/firestore.rules`, indexes `firebase/firestore.indexes.json`; hosting `apps/web/dist` with SPA rewrite) and `.firebaserc` (`demo-gastos`)
- [X] T009 [P] Create CI workflow `.github/workflows/ci.yml` (Node 24, pnpm, Java 21, `pnpm lint`, `pnpm typecheck`, `firebase emulators:exec` running `pnpm test` and `pnpm test:rules`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, API skeleton, Firestore REST access, auth verification, Rules
baseline and web shell. ⚠️ No user story work starts before this phase is complete.

### Tests first

- [X] T010 [P] Write unit tests for the Firestore `Value` codec (integers as strings, safe-int guard, maps, arrays, null, timestamps) in `apps/api/tests/firestore/codec.test.ts`
- [X] T011 [P] Write integration tests for the Firestore REST client against the emulator (get, batchGet, runQuery, beginTransaction+commit, precondition `exists=false` failure, ABORTED retry) in `apps/api/tests/firestore/client.test.ts`
- [X] T012 [P] Write tests for `verifyIdToken` (valid RS256 via local JWKS stub, wrong `aud`/`iss`, expired, non-Google provider, `alg:none` rejected when `ENVIRONMENT!=emulator`, accepted when `emulator`) in `apps/api/tests/auth/verifyIdToken.test.ts`
- [X] T013 [P] Write tests for the HTTP error envelope, correlation id and 401 on missing token in `apps/api/tests/app.test.ts`
- [X] T014 [P] Write baseline Rules tests: every path denies write for authenticated users and denies read for anonymous users, unknown paths deny all, in `firebase/tests/rules.test.ts` (using `@firebase/rules-unit-testing`; add root script `test:rules`)

### Implementation

- [X] T015 [P] Implement ISO 4217 currency table (code → minor units, incl. 0 and 3 decimals) and `isCurrency()` in `packages/finance-engine/src/currencies.ts` (no dependencies) and re-export it from `packages/contracts/src/currencies.ts`
- [X] T016 [P] Implement `ErrorCode` enum + HTTP status map from contracts/http-api.md in `packages/contracts/src/errors.ts`
- [X] T017 [P] Implement domain types and Zod schemas (`TripStatus`, `Role`, `InvitationStatus`, `Trip`, `Member`, `UserProfile`, `normalizeEmail`; every mutable document schema includes `schemaVersion` and `version`) in `packages/contracts/src/domain.ts`
- [X] T018 Implement Firestore `Value` codec in `apps/api/src/firestore/codec.ts` (makes T010 pass)
- [X] T019 Implement service-account OAuth token provider (RS256 JWT via WebCrypto, isolate-level cache ~55 min, emulator `Bearer owner` bypass) in `apps/api/src/firestore/token.ts`
- [X] T020 Implement Firestore REST client (`get`, `batchGet`, `runQuery`, `runTransaction(fn)` with ≤3 retries on ABORTED, writes with preconditions) in `apps/api/src/firestore/client.ts` (makes T011 pass)
- [X] T021 Implement `verifyIdToken` with `jose` remote JWKS and emulator-only unsigned branch in `apps/api/src/auth/verifyIdToken.ts` (makes T012 pass)
- [X] T022 Implement Hono app with middlewares (correlation id, auth → `c.var.user {uid,email,emailVerified}`, Zod validation → `VALIDATION_FAILED`, domain error → envelope, structured logs without PII) in `apps/api/src/index.ts` and `apps/api/src/http/` (makes T013 pass)
- [X] T023 [P] Implement audit writer helper producing `auditEvents` writes with redacted diff inside a transaction in `apps/api/src/services/audit.ts`
- [X] T024 [P] Implement deny-all baseline `firebase/firestore.rules` and empty `firebase/firestore.indexes.json` (makes T014 pass)
- [X] T025 [P] Implement web shell: Firebase init with emulator connection, `apiClient` (attaches ID token, parses error envelope), TanStack Query provider, React Router layout and money/date formatters (`Intl`) in `apps/web/src/lib/firebase.ts`, `apps/web/src/lib/apiClient.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/app/`

**Checkpoint**: `pnpm typecheck && pnpm test && pnpm test:rules` green; API answers 401 without token.

---

## Phase 3: User Story 1 - Cálculo financiero exacto y verificable (Priority: P1) 🎯 MVP

**Goal**: Pure engine computing allocations, adjustments, payers, ledger effects, balances and
both debt views per spec FR-001…FR-012 and clarifications.

**Independent Test**: `pnpm --filter finance-engine test` passes the PRD/spec case catalog and
property suite with ≥ 95 % coverage; no UI or backend involved.

### Tests for User Story 1 (MANDATORY - Test-First) ⚠️

- [X] T026 [P] [US1] Write tests for `minorUnits` and safe-integer guards (USD 2, JPY 0, KWD 3, unknown → error) in `packages/finance-engine/tests/unit/money.test.ts`
- [X] T027 [P] [US1] Write tests for `allocateLargestRemainder` (10.00/3 → 334/333/333 with offset 0, rotation offsets 1 and 2 move the extra unit, 1 unit among N, weights by percent bp, negative totals symmetric) in `packages/finance-engine/tests/unit/allocate.test.ts`
- [X] T028 [P] [US1] Write tests for `computeExpense` covering spec US1 scenarios 1–4: equal/fixed/percent per item and total, Σ bp ≠ 10000 → `INVALID_PERCENT`, item + general discount once, tax proportional, tip equal (per beneficiary), manual adjustment, mixed personal/shared (2700/1500 example), payer not member → `PAYER_NOT_MEMBER`, Σ payers ≠ total → `NOT_RECONCILED`, discount > item → `DISCOUNT_EXCEEDS_ITEM`, item without beneficiary in `packages/finance-engine/tests/unit/expense.test.ts`
- [X] T029 [P] [US1] Write tests for ledger: multi-payer proportional pairwise attribution, personal item paid by other creates debt, `paymentEffect` only for `confirmed` (pending/rejected = no change, spec US1 scenario 5), `negateEffect` restores zero, `rebuildLedger` in `packages/finance-engine/tests/unit/ledger.test.ts`
- [X] T030 [P] [US1] Write tests for `originalDebts` (pairwise netting A→B 10, B→A 4 ⇒ A→B 6) and `simplifiedDebts` (cycle A→B→C→A, determinism, ties by joinOrder) in `packages/finance-engine/tests/unit/debts.test.ts`
- [X] T031 [P] [US1] Write fast-check property suite (≤50 members, ≤100 items, currencies 0/2/3 decimals): reconciliation, Σ net = 0, input-permutation invariance, simplified preserves net and has ≤ transfers than original, `rebuildLedger == fold(incremental)`, 10 000 runs in `packages/finance-engine/tests/property/invariants.test.ts`

### Implementation for User Story 1

- [X] T032 [P] [US1] Implement `minorUnits`, `assertSafeMinor`, `EngineError` in `packages/finance-engine/src/money.ts` (uses `packages/finance-engine/src/currencies.ts`)
- [X] T033 [US1] Implement `allocateLargestRemainder(totalMinor, weights, rotationOffset)` with `bigint` rational shares, descending remainders and rotation tie-break `(seq − 1 + itemIndex) mod N` over joinOrder in `packages/finance-engine/src/allocate.ts`
- [X] T034 [US1] Implement `computeExpense` (item net, item allocation modes, general adjustments proportional/equal/manual, shared vs personal charges, payer distribution) in `packages/finance-engine/src/expense.ts`
- [X] T035 [US1] Implement `LedgerEffect`, `combineEffects`, `negateEffect`, `paymentEffect`, `rebuildLedger` in `packages/finance-engine/src/ledger.ts`
- [X] T036 [US1] Implement `originalDebts` (pairwise netting) and `simplifiedDebts` (greedy, deterministic, joinOrder ties) in `packages/finance-engine/src/debts.ts`
- [X] T037 [US1] Export public API and types in `packages/finance-engine/src/index.ts`; add a performance test asserting 100 items × 50 members < 2 ms (median) in `packages/finance-engine/tests/perf/expense.perf.test.ts`

**Checkpoint**: US1 complete — engine fully verified standalone (SC-001, SC-002, SC-003, scenario 10.00/3).

---

## Phase 4: User Story 2 - Acceso con cuenta Google (Priority: P1)

**Goal**: Google sign-in, persistent profile, logout, protected routes (FR-013…FR-016).

**Independent Test**: Playwright against Auth Emulator: sign in → profile visible → logout →
protected route redirects to login; `users/{uid}` readable only by owner.

### Tests for User Story 2 (MANDATORY - Test-First) ⚠️

- [X] T038 [P] [US2] Write API tests for `POST /v1/me/sync` (creates/updates `users/{uid}` from token, normalizes email, 401 without token) in `apps/api/tests/routes/me.test.ts`
- [X] T039 [P] [US2] Add Rules tests for `users/{uid}` and `users/{uid}/trips/{tripId}` (owner read ok; other user and anonymous denied) in `firebase/tests/rules.test.ts`
- [X] T040 [P] [US2] Write E2E test login → see profile → logout → redirect to `/login` in `apps/web/tests/e2e/auth.spec.ts`

### Implementation for User Story 2

- [X] T041 [US2] Implement `me` service and route `POST /v1/me/sync` in `apps/api/src/services/users.ts` and `apps/api/src/routes/me.ts`
- [X] T042 [US2] Add Rules for `users/{uid}` and `users/{uid}/trips/{tripId}` in `firebase/firestore.rules`
- [X] T043 [US2] Implement `AuthProvider` (onAuthStateChanged, calls `/me/sync` once per session, `signInWithPopup` / `signInWithRedirect` for iOS standalone, `signOut` clears Query cache) in `apps/web/src/features/auth/AuthProvider.tsx`
- [X] T044 [US2] Implement `LoginPage`, `RequireAuth` route guard and account menu with logout in `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/RequireAuth.tsx`, `apps/web/src/features/auth/AccountMenu.tsx`

**Checkpoint**: US2 complete — users can sign in/out; no data visible without session.

---

## Phase 5: User Story 3 - Crear viaje e invitar participantes (Priority: P1)

**Goal**: Create trips, invite by email, accept/decline with verified email, automatic
pending→active, "mis viajes" list (FR-017…FR-022, FR-029…FR-031).

**Independent Test**: creator creates a trip inviting two emails → `pending`; both accept
(verified emails) → `active`; a mismatched email cannot see/accept; list shows trips by status.

### Tests for User Story 3 (MANDATORY - Test-First) ⚠️

- [X] T045 [P] [US3] Write API tests for `POST /v1/trips` (valid → `active` without invitees / `pending` with invitees; invalid currency, endDate < startDate, duplicate or self invite → errors; writes trip, creator member joinOrder 0, `users/{uid}/trips` index, invitation index docs, audit) in `apps/api/tests/routes/trips.create.test.ts`
- [X] T046 [P] [US3] Write API tests for `PATCH /v1/trips/{id}` (name/dates by creator or admin, `expectedVersion` stale → `CONFLICT`, non-member → 404) in `apps/api/tests/routes/trips.update.test.ts`
- [X] T047 [P] [US3] Write API tests for invitations: `POST …/invitations` (creator only, `DUPLICATE_INVITATION`, active→pending when adding invitee), `DELETE …/invitations/{memberKey}` (removes invited/declined, recomputes status; accepted member → `MEMBER_ALREADY_ACCEPTED`, also before the first expense), `accept` (verified email match → member `members/{uid}` with next joinOrder, `inv_*` row and index deleted, last acceptance → `active`; `EMAIL_NOT_VERIFIED`; mismatched email → 404), `decline` (status declined, trip stays pending) in `apps/api/tests/routes/invitations.test.ts`
- [X] T048 [P] [US3] Write concurrency test: two simultaneous accepts and a simultaneous accept + `expectedVersion` edit produce consistent counters and exactly one `CONFLICT` in `apps/api/tests/routes/invitations.concurrency.test.ts`
- [X] T049 [P] [US3] Add Rules tests for `trips/{tripId}`, `trips/{tripId}/members/*` (accepted member ok; invitee and stranger denied) and `invitations/{email}/trips/*` (matching verified email ok; other email and unverified denied) in `firebase/tests/rules.test.ts`
- [X] T050 [P] [US3] Write E2E test: Ana creates trip inviting Pedro and Juan → pending; Pedro and Juan accept in separate contexts → active; Ana's list shows it under active in `apps/web/tests/e2e/trips-invitations.spec.ts`

### Implementation for User Story 3

- [X] T051 [P] [US3] Add Zod request/response schemas for trips and invitations endpoints (documents include `schemaVersion`/`version`, incl. invitation index) in `packages/contracts/src/api/trips.ts` and `packages/contracts/src/api/invitations.ts`
- [X] T052 [US3] Implement trip repository helpers (load trip + members in transaction, status recomputation from counters, `users/{uid}/trips` index sync) in `apps/api/src/services/tripRepo.ts`
- [X] T053 [US3] Implement `createTrip` and `updateTrip` services and routes in `apps/api/src/services/trips.ts` and `apps/api/src/routes/trips.ts`
- [X] T054 [US3] Implement invite/remove/accept/decline services and routes (member key `inv_{sha256(email)[0..16]}`, invitation index, joinOrder assignment, accepted members never removable, audit events) in `apps/api/src/services/invitations.ts` and `apps/api/src/routes/invitations.ts`
- [X] T055 [US3] Add Rules for `trips/{tripId}`, `trips/{tripId}/members/{key}`, `invitations/{email}/trips/{tripId}` (and deny `expenses`, `projections`, `auditEvents`, `idempotencyKeys`) in `firebase/firestore.rules`
- [X] T056 [P] [US3] Implement `TripsListPage` (live query on `users/{uid}/trips`, grouped by status, archived hidden behind a filter) and `InvitationsInbox` (live query on `invitations/{email}/trips`, accept/decline) in `apps/web/src/features/trips/TripsListPage.tsx` and `apps/web/src/features/members/InvitationsInbox.tsx`
- [X] T057 [P] [US3] Implement `CreateTripPage` (React Hook Form + Zod, currency select from ISO table, invite emails chips) in `apps/web/src/features/trips/CreateTripPage.tsx`
- [X] T058 [US3] Implement `TripDetailPage` (trip header, status badge, members list with invitation status, creator actions: invite/remove, edit name/dates with conflict message) in `apps/web/src/features/trips/TripDetailPage.tsx` and `apps/web/src/features/members/MembersPanel.tsx`

**Checkpoint**: US3 complete — trips activate only when everyone accepted (SC-004, SC-005, SC-006 access part).

---

## Phase 6: User Story 4 - Gestionar roles de administración (Priority: P2)

**Goal**: Only the creator promotes/demotes admins; creator role is permanent (FR-023, FR-024).

**Independent Test**: creator promotes and demotes a member; admin attempting to promote → 403;
anyone changing the creator → 403.

### Tests for User Story 4 (MANDATORY - Test-First) ⚠️

- [X] T059 [P] [US4] Write API tests for `PUT /v1/trips/{id}/members/{uid}/role` (creator promotes/demotes; admin → `FORBIDDEN`; target creator → `FORBIDDEN`; target not accepted → `NOT_FOUND`; stale version → `CONFLICT`; index `users/{uid}/trips.role` updated; audit) in `apps/api/tests/routes/roles.test.ts`
- [X] T060 [P] [US4] Write E2E test: Ana promotes Pedro; Pedro sees no role controls in `apps/web/tests/e2e/roles.spec.ts`

### Implementation for User Story 4

- [X] T061 [P] [US4] Add role schemas in `packages/contracts/src/api/roles.ts`
- [X] T062 [US4] Implement `setMemberRole` service and route in `apps/api/src/services/roles.ts` and `apps/api/src/routes/roles.ts`
- [X] T063 [US4] Add promote/demote controls (visible only to creator) to `apps/web/src/features/members/MembersPanel.tsx`

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 - Ciclo de vida del viaje y bloqueos (Priority: P2)

**Goal**: close/reopen/archive/restore transitions, read-only enforcement, service-level expense
create/void with permanent locks, incremental ledger projection and balances endpoint
(FR-021, FR-025…FR-028, FR-008…FR-011 integration).

**Independent Test**: via API: expense on pending trip → `TRIP_NOT_READY`; first expense locks
currency/participants and they stay locked after void; closed/archived reject mutations;
archive/restore returns to previous status; balances endpoint returns both views with equal nets.

### Tests for User Story 5 (MANDATORY - Test-First) ⚠️

- [X] T064 [P] [US5] Write API tests for `POST /v1/trips/{id}/status` (close/reopen by creator or admin; archive/restore by creator only, admin → `FORBIDDEN`; archive from pending/active/closed and restore to `previousStatus`; invalid transitions → `INVALID_TRANSITION`; mutations on closed/archived → `TRIP_READ_ONLY`) in `apps/api/tests/routes/status.test.ts`
- [X] T065 [P] [US5] Write API tests for `POST /v1/trips/{id}/expenses`: pending trip → `TRIP_NOT_READY` (4 invitees, 1 pending); non-member → 404; missing `Idempotency-Key` → 422; same key twice → one expense; engine errors mapped (`NOT_RECONCILED`); success assigns `seq` = 1,2,…, sets `participantsLocked`/`currencyLocked`/`firstExpenseAt`, updates `projections/ledger` and audit in `apps/api/tests/routes/expenses.test.ts`
- [X] T066 [P] [US5] Write API tests for `POST …/expenses/{id}/void` (author, creator, admin allowed; other member → `FORBIDDEN`; ledger effect subtracted; locks remain; then `PATCH currency` → `CURRENCY_LOCKED` and invite → `PARTICIPANTS_LOCKED`) in `apps/api/tests/routes/expenses.void.test.ts`
- [X] T067 [P] [US5] Write API tests for `GET /v1/trips/{id}/balances?view=original|simplified` (10.00/3 paid by creator → +666/−333/−333; both views same `netByMember`; projection equals `rebuildLedger` over stored expenses; non-member → 404) in `apps/api/tests/routes/balances.test.ts`
- [X] T068 [P] [US5] Write concurrency test: simultaneous last acceptance vs expense creation never stores an expense while invitations are pending; parallel expenses get unique consecutive `seq` in `apps/api/tests/routes/expenses.concurrency.test.ts`
- [X] T069 [P] [US5] Write E2E test: Pedro (admin) closes trip → read-only banner; Ana archives → hidden from active list; restore → closed in `apps/web/tests/e2e/lifecycle.spec.ts`

### Implementation for User Story 5

- [X] T070 [P] [US5] Add schemas for status action, `ExpenseInput` API body, void and balances responses in `packages/contracts/src/api/status.ts`, `packages/contracts/src/api/expenses.ts`, `packages/contracts/src/api/balances.ts`
- [X] T071 [US5] Implement trip state machine (allowed transitions per role, `previousStatus`, read-only guard reused by all mutating services) in `apps/api/src/services/tripStatus.ts` and route `apps/api/src/routes/status.ts`; apply the read-only guard in `apps/api/src/services/trips.ts`, `invitations.ts` and `roles.ts`
- [X] T072 [US5] Implement idempotency helper (`idempotencyKeys/{tripId}_{uid}_{key}` with `exists=false` precondition, stored response replay) in `apps/api/src/services/idempotency.ts`
- [X] T073 [US5] Implement `createExpense` and `voidExpense` services (transaction: membership, status, idempotency, `computeExpense` with joinOrder members and `seq`, store `ledgerEffect`, update `projections/ledger`, locks, `expenseSeq`, audit) and routes in `apps/api/src/services/expenses.ts` and `apps/api/src/routes/expenses.ts`
- [X] T074 [US5] Enforce `CURRENCY_LOCKED` in `updateTrip` and `PARTICIPANTS_LOCKED` in invite/remove in `apps/api/src/services/trips.ts` and `apps/api/src/services/invitations.ts`
- [X] T075 [US5] Implement `getBalances` service and route (reads projection + members, returns `originalDebts` or `simplifiedDebts`) in `apps/api/src/services/balances.ts` and `apps/api/src/routes/balances.ts`
- [X] T076 [P] [US5] Add status actions (close/reopen for creator/admin, archive/restore for creator), read-only banner and lock indicators to `apps/web/src/features/trips/TripDetailPage.tsx` and `apps/web/src/features/trips/TripStatusActions.tsx`
- [X] T077 [P] [US5] Implement read-only `BalancesPanel` with original/simplified toggle and currency formatting in `apps/web/src/features/balances/BalancesPanel.tsx`

**Checkpoint**: All user stories complete; the three critical scenarios (TRIP_NOT_READY, 10.00/3, frozen currency) pass as automated tests (SC-007, SC-008).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T078 [P] Accessibility pass (labels, focus order, contrast, error messages) with `@axe-core/playwright` checks in `apps/web/tests/e2e/a11y.spec.ts`
- [X] T079 [P] PWA installability: icons, manifest name/colors, theme, standalone display in `apps/web/public/` and `apps/web/vite.config.ts`
- [X] T080 [P] Security review of Rules, token verification and error responses (no existence leaks, no PII in logs) — record findings in `specs/001-finance-engine-trips/checklists/security.md`
- [X] T081 [P] Add `apps/api/README.md` with deploy steps (`wrangler secret put FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`) and Firebase Spark setup (Auth Google provider, Firestore, Hosting, authorized domains)
- [X] T082 Verify CPU budget: add per-route timing log in emulator runs and confirm < 10 ms CPU (Node measurement `apps/api/perf/cpu.perf.ts`, since workerd freezes timers) with notes in `specs/001-finance-engine-trips/checklists/performance.md`
- [X] T083 Run `quickstart.md` manual acceptance walkthrough end-to-end and fix any drift between docs and behavior

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories → **Polish (Phase 8)**.
- **US1** depends only on Setup + T015 (currencies); it can start in parallel with the rest of
  Phase 2.
- **US2** depends on Foundational.
- **US3** depends on Foundational and US2 (needs authenticated user/profile and web auth shell).
- **US4** depends on US3 (members must exist).
- **US5** depends on US1 (engine) and US3 (trips/members). It can run in parallel with US4,
  but T071 touches `roles.ts` after T062, so finish US4 first or coordinate.

### Within Each User Story

- Tests MUST be written and FAIL before implementation.
- Contracts/schemas → services → routes → Rules → UI.
- Each story is committed and validated at its checkpoint.

### Parallel Opportunities

- Phase 1: T003–T009 in parallel after T001–T002.
- Phase 2: all test tasks T010–T014 in parallel; T015–T017, T023–T025 in parallel.
- US1: all tests T026–T031 in parallel; T032 in parallel with tests.
- US3: tests T045–T050 in parallel; UI tasks T056–T057 in parallel once routes exist.
- US5: tests T064–T069 in parallel; UI T076–T077 in parallel.

---

## Parallel Example: User Story 1

```bash
Task: "T027 allocate tests in packages/finance-engine/tests/unit/allocate.test.ts"
Task: "T028 expense tests in packages/finance-engine/tests/unit/expense.test.ts"
Task: "T029 ledger tests in packages/finance-engine/tests/unit/ledger.test.ts"
Task: "T030 debts tests in packages/finance-engine/tests/unit/debts.test.ts"
Task: "T031 property suite in packages/finance-engine/tests/property/invariants.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T045 trips.create tests"   Task: "T047 invitations tests"
Task: "T049 Rules tests"          Task: "T050 E2E trips-invitations"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → T015 currencies.
2. Phase 3 US1 (engine) → **STOP and VALIDATE**: property suite and catalog green, coverage ≥ 95 %.
   This de-risks RF-43 before any infrastructure.

### Incremental Delivery

1. Finish Phase 2 Foundational (API skeleton, Firestore REST, Rules baseline, web shell).
2. US2 login → demo sign-in.
3. US3 trips + invitations → demo trip activation (core of Fase 1 PRD).
4. US4 roles → US5 lifecycle, locks, service-level expenses and balances.
5. Phase 8 polish → quickstart walkthrough.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- Commit after each task or logical group (no AI co-author trailers, per constitution).
- Never weaken a test to make it pass; amend the spec/plan instead.
