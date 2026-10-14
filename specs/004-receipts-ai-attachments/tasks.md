---

description: "Task list for 004-receipts-ai-attachments"
---

# Tasks: IA y adjuntos (Fase 4)

**Input**: `specs/004-receipts-ai-attachments/` · Base: 001–003 in `main`.

**Tests**: MANDATORY (Constitution V). Write each test task first and see it fail.

**Stories**: US1 escanear factura · US2 adjuntar comprobantes · US3 cuotas IA · US4 retención.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add `nodejs_compat` flag, an `env.emulator` section (R2 binding `LOCAL_BLOBS`, vars `AI_PROVIDER=fake`, `STORAGE=local`, `LOCAL_BLOB_SECRET`) and an hourly Cron Trigger to `apps/api/wrangler.jsonc`; mirror the emulator bindings in `apps/api/vitest.config.ts`; add `aws4fetch` to `apps/api/package.json`; `dev` script uses `--env emulator`
- [X] T002 [P] Add error codes `AI_CONSENT_REQUIRED` (403), `AI_QUOTA_EXCEEDED` (429), `AI_UNAVAILABLE` (503), `ATTACHMENT_INVALID` (422), `ATTACHMENT_DUPLICATE` (409) to `packages/contracts/src/errors.ts` and Spanish messages in `apps/web/src/components/ErrorMessage.tsx`
- [X] T003 [P] Add Firestore indexes for collection groups `attachments` (status, expiresAt) and `uploads` (status, expiresAt) in `firebase/firestore.indexes.json`

---

## Phase 2: Foundational

### Tests first

- [X] T004 [P] Write tests for `addCalendarMonths`/`attachmentExpiry`/`isExpiringSoon` (31-mar→30-sep, 29-feb→29-ago, 31-ago→28/29-feb, UTC, 14-day window) in `packages/contracts/tests/retention.test.ts`
- [X] T005 [P] Write tests for `ReceiptDraft` schema, `normalizeDraft` (decimals per currency, negative/huge amounts flagged, quantity ≥ 1, future date flagged) and `draftWarnings` (CURRENCY_MISMATCH, TOTAL_MISMATCH, LOW_CONFIDENCE, EMPTY) and `draftToExpenseDraftInput` in `packages/contracts/tests/receipts.test.ts`
- [X] T006 [P] Write API tests for `LocalStorageProvider` (signed PUT/GET round trip, expired/forged token rejected, head/delete idempotent) and `B2StorageProvider` presign (SigV4 query params, 15-min expiry, key scoping) with mocked fetch in `apps/api/tests/providers/storage.test.ts`
- [X] T007 [P] Write tests for `GeminiReceiptProvider` (request shape with inline_data + JSON schema + model from env, valid response parsed, invalid JSON → AI_UNAVAILABLE, 429/5xx → AI_UNAVAILABLE) and `FakeReceiptProvider` determinism in `apps/api/tests/providers/ai.test.ts`
- [X] T008 [P] Add Rules tests per contracts/access-rules.md (004): expense attachments like parent, settlement attachments for from/to/managers, uploads and scans only own, aiUsage denied, in `firebase/tests/rules.test.ts`

### Implementation

- [X] T009 [P] Implement `packages/contracts/src/retention.ts` (makes T004 pass)
- [X] T010 [P] Implement `packages/contracts/src/receipts.ts` and `providers.ts` interfaces (makes T005 pass)
- [X] T011 [P] Implement storage providers in `apps/api/src/providers/localStorage.ts`, `b2.ts` (aws4fetch) and a `supabase.ts` stub with `createStorageProvider(env)`; route `apps/api/src/routes/localBlobs.ts` (emulator only) (makes T006 pass)
- [X] T012 [P] Implement AI providers in `apps/api/src/providers/gemini.ts`, `fakeAi.ts` with `createAiProvider(env)` (makes T007 pass)
- [X] T013 Add Rules for attachments, uploads, scans and aiUsage in `firebase/firestore.rules` (makes T008 pass)

**Checkpoint**: pure helpers, providers and Rules green.

---

## Phase 3: User Story 2 - Adjuntar comprobantes (Priority: P1)

(Implemented before US1 because scanning reuses uploads and attachments.)

### Tests (MANDATORY) ⚠️

- [X] T014 [P] [US2] Write API tests in `apps/api/tests/routes/attachments.test.ts`: create uploads (type/size/pages validation → ATTACHMENT_INVALID; duplicate sha256 on target expense → ATTACHMENT_DUPLICATE); PUT via local URL; link to a new expense (`attachmentUploadIds`) and to an existing one; head() mismatch → ATTACHMENT_INVALID and object deleted; expiresAt = +6 calendar months; download URL only for viewers (non-involved 404, PRD «comprobante privado»), expired URL rejected; remove by author/creator/admin only; settlement proof by emitter, visible to receiver
- [X] T015 [P] [US2] Write E2E in `apps/web/tests/e2e/attachments.spec.ts`: attach 2 images + 1 PDF to an expense, open one (download link), duplicate warning on re-upload, non-involved participant cannot open it, attach a proof to a payment

### Implementation

- [X] T016 [P] [US2] Add attachment/upload schemas in `packages/contracts/src/api/attachments.ts`; extend `CreateExpenseBody` with `attachmentUploadIds?`, `scanId?`
- [X] T017 [US2] Implement `createUploads`, `linkUploads` (shared by expense create, attach-to-existing and settlement proof), `removeAttachment`, `attachmentUrl` in `apps/api/src/services/uploads.ts` and `attachments.ts`, routes in `apps/api/src/routes/attachments.ts`; link uploads inside `createExpense` (source, attachmentCount) (makes T014 pass)
- [X] T018 [P] [US2] Implement web helpers `sha256Hex(file)`, `compressImage(file)`, `pdfPageCount(file)` (lightweight PDF page counting) and `uploadFiles(tripId, files, target)` in `apps/web/src/features/attachments/upload.ts`
- [X] T019 [US2] Implement `AttachmentPicker` (multiple files, camera capture, progress, duplicate message) and `AttachmentList` (open via signed URL, remove, expiry notice ≤ 14 days, «eliminado por política de retención») in `apps/web/src/features/attachments/`; wire into `NewExpensePage`, `ExpenseDetailPage` and `PaySettlementPage`/`SettlementsPanel`

**Checkpoint**: private attachments end-to-end.

---

## Phase 4: User Story 1 - Escanear factura (Priority: P1) 🎯

### Tests (MANDATORY) ⚠️

- [X] T020 [P] [US1] Write API tests in `apps/api/tests/routes/scans.test.ts`: consent required (403) then accepted/revoked via `/me/ai-consent`; scan with fake provider returns normalized draft + warnings (currency mismatch); only own pending uploads; > 5 files / > 10 pages / > 4 MB → ATTACHMENT_INVALID without provider call; idempotent with same key; two uploads with the same sha256 in one scan → DUPLICATE_PAGE warning; provider failure → AI_UNAVAILABLE and uploads kept; saving the expense with `scanId` links uploads and sets `source: 'ai'`
- [X] T021 [P] [US1] Write unit tests for `draftToFormDraft` (items, quantities, tax/tip/discount as adjustments, low-confidence field keys) in `apps/web/tests/unit/scanDraft.test.ts`
- [X] T022 [P] [US1] Write E2E in `apps/web/tests/e2e/scan.spec.ts`: «Escanear factura» enabled → consent dialog → upload a receipt image → form prefilled with fake items, low-confidence fields highlighted, currency warning; save blocked until balanced; saved expense shows «Escaneado» and the image; AI failure path offers manual registration with the image

### Implementation

- [X] T023 [P] [US1] Add scan and consent schemas in `packages/contracts/src/api/scans.ts`, `api/consent.ts`
- [X] T024 [US1] Implement `setAiConsent`/`revokeAiConsent` (`apps/api/src/services/consent.ts`) and `scanReceipt` (`apps/api/src/services/scans.ts`: consent, idempotency, upload validation, quota reservation hook, provider call, normalization, metrics, release on failure) with routes (makes T020 pass)
- [X] T025 [P] [US1] Implement `draftToFormDraft` in `apps/web/src/features/scan/scanDraft.ts` (makes T021 pass)
- [X] T026 [US1] Implement `ScanPage` (consent dialog with version, capture/select, compress, upload, progress, errors with «Registrar a mano»), route `/trips/:tripId/scan`; enable «Escanear factura» in `QuickActions`; `NewExpensePage` accepts a scan prefill (highlights via `aria-describedby` + text badges, currency warning banner, attachments from the scan, `scanId` on save)

---

## Phase 5: User Story 3 - Cuotas IA (Priority: P2)

### Tests (MANDATORY) ⚠️

- [X] T027 [P] [US3] Write API tests in `apps/api/tests/routes/quotas.test.ts`: trip daily limit (21st scan → AI_QUOTA_EXCEEDED, provider not called); global day/month limits; concurrent scans at the limit → only one passes; provider failure releases the reservation; per-file retry limit; idempotent retry does not consume twice; `GET /admin/ai-usage` aggregates by day/trip/user/provider and is forbidden to non-admins
- [X] T028 [P] [US3] Write E2E in `apps/web/tests/e2e/quota.spec.ts` (emulator with `AI_QUOTA_TRIP_DAY=1`): second scan shows «cuota de escaneo agotada» with the manual registration link

### Implementation

- [X] T029 [US3] Implement `reserveQuota`/`commitUsage`/`releaseQuota` in `apps/api/src/services/quotas.ts` and wire into `scanReceipt` (makes T027 pass)
- [X] T030 [US3] Implement `GET /v1/admin/ai-usage` in `apps/api/src/routes/admin.ts` (ADMIN_UIDS)
- [X] T031 [US3] Show remaining scans and the quota-exhausted state in `ScanPage` and `QuickActions`

---

## Phase 6: User Story 4 - Retención (Priority: P2)

### Tests (MANDATORY) ⚠️

- [X] T032 [P] [US4] Write API tests in `apps/api/tests/routes/retention.test.ts`: `runRetention(now)` deletes expired expense and settlement attachments exactly once (re-run is a no-op), marks `deleted` + audit, keeps expense/balances unchanged, retries failures (`deleteAttempts`), cleans pending uploads older than 24 h, batch limit respected; `scheduled()` handler calls it
- [X] T033 [P] [US4] Write E2E in `apps/web/tests/e2e/retention.spec.ts`: an attachment expiring in 10 days shows the notice on the expense and the trip home (only for viewers); after `runRetention` the expense shows «eliminado por política de retención»

### Implementation

- [X] T034 [US4] Implement `runRetention` in `apps/api/src/services/retention.ts`, `scheduled` export in `apps/api/src/index.ts`, and an emulator-only `POST /v1/local-admin/run-retention?now=` for tests (makes T032 pass)
- [X] T035 [US4] Implement expiring-soon list on the trip home (visible expenses only) in `apps/web/src/features/attachments/ExpiringNotice.tsx`

---

## Phase 7: Polish

- [X] T036 [P] Extend `apps/web/tests/e2e/a11y.spec.ts` with consent dialog, scan page, prefilled form with highlights, attachment list at 360 px
- [X] T037 [P] Extend `apps/api/perf/cpu.perf.ts` with draft normalization + presign + quota bookkeeping (< 5 ms)
- [X] T038 [P] Security review in `specs/004-receipts-ai-attachments/checklists/security.md` (URL TTL, no content in logs, consent enforcement, local endpoints unavailable outside emulator, key scoping)
- [X] T039 [P] Update `apps/api/README.md` (B2 bucket/CORS/keys, Gemini key/model, quotas, cron), root `README.md`, and the 003 contract cross-reference
- [X] T040 Full validation (lint, typecheck, unit, API ×3, Rules, perf, E2E) and quickstart walkthrough; fix drift

---

## Dependencies & Execution Order

Setup → Foundational → US2 (uploads/attachments) → US1 (scan) → US3 (quotas into scan) → US4 (retention) → Polish.

### Parallel Opportunities

T002–T003; T004–T008; T009–T012; US2 tests T014–T015 with T016, T018; US1 T020–T022 with T023, T025; US3 T027–T028; US4 T032–T033.

## Implementation Strategy

1. Foundational (pure helpers + providers + Rules).
2. US2 (private attachments) → US1 (scan, MVP of the phase) → US3 → US4 → Polish.

## Notes

- Commit per phase (no AI co-author trailers). Never weaken a test; amend spec/plan instead.
- Real B2/Gemini credentials are not required for any test; production verification is a deploy step.
