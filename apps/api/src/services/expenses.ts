import type { CreateExpenseBody } from 'contracts';
import {
  combineEffects,
  computeExpense,
  negateEffect,
  type ExpenseInput,
  type LedgerEffect,
  type Member,
  type MemberCharge,
} from 'finance-engine';
import type { z } from 'zod';
import type { Firestore, Transaction } from '../firestore/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { writeAudit } from './audit.js';
import { ensureActiveCategory } from './categories.js';
import { findIdempotent, idempotencyPath, recordIdempotent } from './idempotency.js';
import { applyToLedger, readLedger } from './ledgerRepo.js';
import {
  affectedUids,
  readProjections,
  refundAsExpense,
  writeExpenseToProjections,
  writeProjectionsDelta,
  type ExpenseForProjection,
  type RefundForProjection,
} from './projections.js';
import {
  assertMutable,
  loadTripForMember,
  newId,
  toTripDto,
  writeTrip,
  type LoadedTrip,
  type MutationContext,
} from './tripRepo.js';
import { canVoidExpense, viewerUidsOf } from './visibility.js';

type ExpenseBody = z.output<typeof CreateExpenseBody>;

/** Expense document schema version (3: item quantity, refunds, restore — feature 003). */
export const EXPENSE_SCHEMA_VERSION = 3;

export interface ExpenseDoc {
  seq: number;
  description: string;
  transactionDate: string;
  categoryId: string;
  totalMinor: number;
  payers: { uid: string; amountMinor: number }[];
  payerUids: string[];
  items: { beneficiaries: string[]; classification: 'shared' | 'personal' }[];
  viewerUids: string[];
  sharedTotalMinor: number;
  personalTotalMinor: number;
  chargesByMember: Record<string, MemberCharge>;
  status: 'active' | 'voided';
  createdBy: string;
  ledgerEffect: LedgerEffect;
  version: number;
}

export const expensePath = (tripId: string, expenseId: string) => `trips/${tripId}/expenses/${expenseId}`;

const summary = (id: string, e: Pick<ExpenseDoc, 'seq' | 'totalMinor' | 'status' | 'version' | 'chargesByMember'>) => ({
  id,
  seq: e.seq,
  totalMinor: e.totalMinor,
  status: e.status,
  version: e.version,
  chargesByMember: e.chargesByMember,
});

/** Expenses require an active trip: pending → TRIP_NOT_READY (RF-33), closed/archived → read-only. */
function assertAcceptsExpenses({ trip }: LoadedTrip): void {
  assertMutable(trip);
  if (trip.data.status === 'pending') {
    throw new AppError('TRIP_NOT_READY', 'Every invitee must accept before the first expense', {
      pendingInvitationCount: trip.data.pendingInvitationCount,
      declinedInvitationCount: trip.data.declinedInvitationCount,
    });
  }
}

function engineMembers(loaded: LoadedTrip): Member[] {
  return loaded.members
    .filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid !== null)
    .map((m) => ({ uid: m.data.uid!, joinOrder: m.data.joinOrder ?? 0 }));
}

const sortedUnique = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Fields derived from the body and the engine result (shared by create and update). */
function deriveExpenseFields(body: ExpenseBody, input: ExpenseInput, computed: ReturnType<typeof computeExpense>, createdBy: string) {
  const charges = Object.values(computed.chargesByMember);
  return {
    description: body.description,
    transactionDate: body.transactionDate,
    categoryId: body.categoryId,
    notes: body.notes ?? null,
    servicePeriod: body.servicePeriod ?? null,
    totalMinor: body.totalMinor,
    payers: body.payers,
    payerUids: sortedUnique(body.payers.map((p) => p.uid)),
    splitMode: body.splitMode,
    items: input.items,
    adjustments: input.adjustments,
    beneficiaryUids: sortedUnique(body.items.flatMap((i) => i.beneficiaries)),
    personalBeneficiaryUids: sortedUnique(
      body.items.filter((i) => i.classification === 'personal').flatMap((i) => i.beneficiaries),
    ),
    viewerUids: viewerUidsOf({ createdBy, payers: body.payers, items: body.items }),
    sharedTotalMinor: charges.reduce((a, c) => a + c.sharedMinor, 0),
    personalTotalMinor: charges.reduce((a, c) => a + c.personalMinor, 0),
    chargesByMember: computed.chargesByMember,
    ledgerEffect: computed.ledgerEffect,
  };
}

function engineInput(body: ExpenseBody, seq: number, loaded: LoadedTrip): ExpenseInput {
  return {
    seq,
    totalMinor: body.totalMinor,
    payers: body.payers,
    splitMode: body.splitMode,
    items: body.items.map((i) => ({ ...i, discountMinor: i.discountMinor ?? 0 })) as ExpenseInput['items'],
    adjustments: body.adjustments as ExpenseInput['adjustments'],
    members: engineMembers(loaded),
  };
}

/** Hook for duplicate detection (US7); returns normally when the expense may be saved. */
export type DuplicateCheck = (
  tx: Transaction,
  loaded: LoadedTrip,
  body: ExpenseBody,
  payerUids: string[],
) => Promise<void>;

/** Feature 004: receipts linked in the same transaction as the expense creation. */
export interface ExpenseAttachments {
  /** Links the verified uploads to the new expense; returns how many attachments were created. */
  link: (tx: Transaction, expenseId: string) => Promise<number>;
  source: 'manual' | 'ai';
  scanId: string | null;
}

/**
 * Registers an expense (FR-002…FR-013): validates category and amounts with the finance engine,
 * assigns the immutable sequence number, derives the visibility set (RF-38), locks currency and
 * participants on the first expense, and updates ledger + dashboard projections atomically.
 */
export async function createExpense(
  db: Firestore,
  tripId: string,
  body: ExpenseBody,
  idempotencyKey: string,
  ctx: MutationContext,
  checkDuplicates?: DuplicateCheck,
  attachments?: ExpenseAttachments,
) {
  const idemPath = idempotencyPath(tripId, ctx.actorUid, idempotencyKey);
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertAcceptsExpenses(loaded);
    const { trip } = loaded;

    const previous = await findIdempotent(tx, idemPath);
    if (previous) {
      const existing = await tx.get(expensePath(tripId, previous.resultRef));
      if (!existing) throw new AppError('CONFLICT', 'Idempotency key refers to a missing expense');
      // Same key again: replay the original result, no new effect and no duplicate warning.
      return { expense: summary(existing.id, existing.data as unknown as ExpenseDoc), trip: toTripDto(tripId, trip.data) };
    }

    await ensureActiveCategory(tx, tripId, body.categoryId, ctx.now);

    const seq = trip.data.expenseSeq + 1;
    const input = engineInput(body, seq, loaded);
    const computed = computeExpense(input);

    const payerUids = sortedUnique(body.payers.map((p) => p.uid));
    if (checkDuplicates && !body.confirmDuplicate) await checkDuplicates(tx, loaded, body, payerUids);

    const derived = deriveExpenseFields(body, input, computed, ctx.actorUid);
    const expenseId = newId();
    const attachmentCount = attachments ? await attachments.link(tx, expenseId) : 0;
    const expense = {
      seq,
      ...derived,
      source: attachments?.source ?? 'manual',
      scanId: attachments?.scanId ?? null,
      attachmentCount,
      currency: trip.data.currency,
      status: 'active' as const,
      createdBy: ctx.actorUid,
      idempotencyKey,
      recordedAt: ctx.now,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      voidedAt: null,
      schemaVersion: EXPENSE_SCHEMA_VERSION,
      version: 1,
      duplicateConfirmed: body.confirmDuplicate === true,
      refundedByItem: {},
      restoredAt: null,
    };

    const ledger = await readLedger(tx, tripId);
    const projections = await readProjections(tx, tripId, affectedUids(expense));
    tx.set(expensePath(tripId, expenseId), expense, { exists: false });
    const next = writeTrip(
      tx,
      trip,
      {
        expenseSeq: seq,
        participantsLocked: true,
        currencyLocked: true,
        firstExpenseAt: trip.data.firstExpenseAt ?? ctx.now,
      },
      ctx.now,
    );
    applyToLedger(tx, tripId, ledger, computed.ledgerEffect, next.version);
    writeExpenseToProjections(tx, tripId, projections, expense, 1);
    recordIdempotent(tx, idemPath, { operation: 'expense.create', resultRef: expenseId }, ctx.now);
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'expense.create',
        entityType: 'expense',
        entityId: expenseId,
        beforeVersion: null,
        afterVersion: 1,
        correlationId: ctx.correlationId,
        diff: { seq, totalMinor: body.totalMinor, items: body.items.length, categoryId: body.categoryId },
      },
      ctx.now,
    );
    return { expense: summary(expenseId, expense), trip: toTripDto(tripId, next) };
  });
}

/** Soft delete (RF-29): subtracts ledger and projections; locks stay in place (RF-55). */
export async function voidExpense(
  db: Firestore,
  tripId: string,
  expenseId: string,
  expectedVersion: number,
  ctx: MutationContext,
  opts: VoidRestoreOptions = {},
) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    const doc = await tx.get(expensePath(tripId, expenseId));
    if (!doc) throw notFound('Expense');
    const expense = doc.data as unknown as ExpenseDoc;
    const member = loaded.me.data;
    if (expense.status === 'active' && !canVoidExpense(member, expense, loaded.trip.data.status)) {
      // Do not reveal expenses the caller cannot even see.
      if (!expense.viewerUids?.includes(ctx.actorUid) && member.role === 'member') throw notFound('Expense');
      throw forbidden('Only the author, the creator or an admin can void an expense');
    }
    if (expense.version !== expectedVersion) {
      throw new AppError('CONFLICT', 'The expense was modified by someone else', { currentVersion: expense.version });
    }
    if (expense.status !== 'active') throw new AppError('INVALID_TRANSITION', 'The expense is already voided');

    const voided = { ...doc.data, status: 'voided', voidedAt: ctx.now, updatedAt: ctx.now, version: expense.version + 1 };
    const refundEffects = opts.refundEffects ? await opts.refundEffects(tx) : [];
    const ledgerChange = negateEffect(combineEffects(expense.ledgerEffect, ...refundEffects));
    if (opts.assertPreview) {
      await opts.assertPreview({ tx, loaded, expectedLedgerRevision: opts.expectedLedgerRevision, changes: [ledgerChange] });
    }
    const ledger = await readLedger(tx, tripId);
    const forProjection = {
      categoryId: expense.categoryId,
      payers: expense.payers,
      chargesByMember: expense.chargesByMember,
      viewerUids: expense.viewerUids ?? viewerUidsOf(expense),
      sharedTotalMinor: expense.sharedTotalMinor ?? 0,
    };
    const hasProjection = expense.categoryId !== undefined;
    const refundDeltas = opts.refundProjections ? (await opts.refundProjections(tx, forProjection)).map(refundAsExpense) : [];
    const projections = hasProjection ? await readProjections(tx, tripId, affectedUids(forProjection, ...refundDeltas)) : null;

    tx.set(expensePath(tripId, expenseId), voided, { updateTime: doc.updateTime });
    const next = writeTrip(tx, loaded.trip, {}, ctx.now);
    applyToLedger(tx, tripId, ledger, ledgerChange, next.version);
    if (projections) {
      writeProjectionsDelta(tx, tripId, projections, [
        { expense: forProjection, sign: -1 },
        ...refundDeltas.map((r) => ({ expense: r, sign: -1 as const, count: 0 as const })),
      ]);
    }
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'expense.void',
        entityType: 'expense',
        entityId: expenseId,
        beforeVersion: expense.version,
        afterVersion: expense.version + 1,
        correlationId: ctx.correlationId,
      },
      ctx.now,
    );
    return { expense: summary(expenseId, voided as unknown as ExpenseDoc) };
  });
}

const DIFF_FIELDS = [
  'description',
  'categoryId',
  'transactionDate',
  'servicePeriod',
  'notes',
  'totalMinor',
  'payers',
  'splitMode',
  'items',
  'adjustments',
] as const;

/** Names of the fields that changed (history and conflict diffs never carry per-item amounts). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return DIFF_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null));
}

export interface VoidRestoreOptions extends EditGuards {
  expectedLedgerRevision?: number | undefined;
  /** Ledger effects of the expense refunds (they follow the expense when voided/restored). */
  refundEffects?: (tx: Transaction) => Promise<LedgerEffect[]>;
  /** Refunds as projection entries, using the expense's category and viewers. */
  refundProjections?: (tx: Transaction, expense: ExpenseForProjection) => Promise<RefundForProjection[]>;
  checkDuplicates?: DuplicateCheck;
  confirmDuplicate?: boolean | undefined;
}

export interface EditGuards {
  /** Refunds as projection entries (moved with viewers/category on edit). */
  refundProjections?: (tx: Transaction, expense: ExpenseForProjection) => Promise<RefundForProjection[]>;
  /** Feature 003 / US3: impact preview guard; throws PREVIEW_REQUIRED or CONFLICT. */
  assertPreview?: (args: {
    tx: Transaction;
    loaded: LoadedTrip;
    expectedLedgerRevision: number | undefined;
    changes: LedgerEffect[];
  }) => Promise<void>;
}

type UpdateBody = ExpenseBody & { expectedVersion: number; expectedLedgerRevision?: number | undefined };

/** Refunds already registered constrain the edit (US5): items cannot drop below what was refunded. */
function assertRefundConstraints(previous: ExpenseDoc & { refundedByItem?: Record<string, { quantity: number; amountMinor: number }> }, input: ExpenseInput, maxOf: (itemId: string, quantity: number) => number) {
  for (const [itemId, refunded] of Object.entries(previous.refundedByItem ?? {})) {
    const item = input.items.find((i) => i.id === itemId) as (ExpenseInput['items'][number] & { quantity?: number }) | undefined;
    if (!item) throw new AppError('REFUND_CONSTRAINT', 'An item with refunds cannot be removed', { itemId });
    const quantity = item.quantity ?? 1;
    if (quantity < refunded.quantity || maxOf(itemId, quantity) < refunded.amountMinor) {
      throw new AppError('REFUND_CONSTRAINT', 'An item cannot drop below what was already refunded', { itemId });
    }
  }
}

/**
 * RF-10/RF-36: edit an active expense with optimistic versioning. Keeps `seq` and the original
 * author, recomputes charges, visibility (viewerUids), ledger and projections as −old +new.
 */
export async function updateExpense(
  db: Firestore,
  tripId: string,
  expenseId: string,
  body: UpdateBody,
  ctx: MutationContext,
  guards: EditGuards = {},
  maxRefundable?: (input: ExpenseInput, itemId: string, quantity: number) => number,
) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    const doc = await tx.get(expensePath(tripId, expenseId));
    if (!doc) throw notFound('Expense');
    const previous = doc.data as unknown as ExpenseDoc & { categoryId: string; refundedByItem?: Record<string, { quantity: number; amountMinor: number }> };
    const member = loaded.me.data;
    const canSee = previous.viewerUids?.includes(ctx.actorUid) || member.role !== 'member';
    if (!canSee) throw notFound('Expense');
    if (previous.createdBy !== ctx.actorUid && member.role === 'member') {
      throw forbidden('Only the author, the creator or an admin can edit an expense');
    }
    if (previous.status !== 'active') throw new AppError('INVALID_TRANSITION', 'Voided expenses cannot be edited');
    if (previous.version !== body.expectedVersion) {
      throw new AppError('CONFLICT', 'The expense was modified by someone else', { currentVersion: previous.version });
    }
    if (body.categoryId !== previous.categoryId) await ensureActiveCategory(tx, tripId, body.categoryId, ctx.now);

    const input = engineInput(body, previous.seq, loaded);
    const computed = computeExpense(input);
    if (maxRefundable) assertRefundConstraints(previous, input, (itemId, q) => maxRefundable(input, itemId, q));
    const derived = deriveExpenseFields(body, input, computed, previous.createdBy);
    const oldProjection = { ...previous, viewerUids: previous.viewerUids ?? viewerUidsOf(previous) } as unknown as ExpenseForProjection;
    const newProjection = derived as unknown as ExpenseForProjection;
    const ledgerDelta = combineEffects(negateEffect(previous.ledgerEffect), computed.ledgerEffect);

    if (guards.assertPreview) {
      await guards.assertPreview({ tx, loaded, expectedLedgerRevision: body.expectedLedgerRevision, changes: [ledgerDelta] });
    }
    // Refunds keep their amounts but follow the expense's viewers and category in the projections.
    const oldRefunds = guards.refundProjections ? (await guards.refundProjections(tx, oldProjection)).map(refundAsExpense) : [];
    const newRefunds = oldRefunds.length && guards.refundProjections ? (await guards.refundProjections(tx, newProjection)).map(refundAsExpense) : [];
    const ledger = await readLedger(tx, tripId);
    const projections = await readProjections(tx, tripId, affectedUids(oldProjection, newProjection, ...oldRefunds, ...newRefunds));
    const updated = { ...doc.data, ...derived, updatedAt: ctx.now, version: previous.version + 1, schemaVersion: EXPENSE_SCHEMA_VERSION };
    tx.set(expensePath(tripId, expenseId), updated, { updateTime: doc.updateTime });
    const next = writeTrip(tx, loaded.trip, {}, ctx.now);
    applyToLedger(tx, tripId, ledger, ledgerDelta, next.version);
    writeProjectionsDelta(tx, tripId, projections, [
      { expense: oldProjection, sign: -1 },
      { expense: newProjection, sign: 1 },
      ...oldRefunds.map((r) => ({ expense: r, sign: -1 as const, count: 0 as const })),
      ...newRefunds.map((r) => ({ expense: r, sign: 1 as const, count: 0 as const })),
    ]);
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'expense.update',
        entityType: 'expense',
        entityId: expenseId,
        beforeVersion: previous.version,
        afterVersion: previous.version + 1,
        correlationId: ctx.correlationId,
        diff: { changed: changedFields(doc.data, updated) },
      },
      ctx.now,
    );
    return { expense: summary(expenseId, updated as unknown as ExpenseDoc), trip: toTripDto(tripId, next) };
  });
}


/** RF-29: restore a voided expense (same permissions as void); refunds count again. */
export async function restoreExpense(
  db: Firestore,
  tripId: string,
  expenseId: string,
  expectedVersion: number,
  ctx: MutationContext,
  opts: VoidRestoreOptions = {},
) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    const doc = await tx.get(expensePath(tripId, expenseId));
    if (!doc) throw notFound('Expense');
    const expense = doc.data as unknown as ExpenseDoc & { transactionDate: string; categoryId: string };
    const member = loaded.me.data;
    if (!expense.viewerUids?.includes(ctx.actorUid) && member.role === 'member') throw notFound('Expense');
    if (expense.createdBy !== ctx.actorUid && member.role === 'member') {
      throw forbidden('Only the author, the creator or an admin can restore an expense');
    }
    if (expense.status !== 'voided') throw new AppError('INVALID_TRANSITION', 'Only voided expenses can be restored');
    if (expense.version !== expectedVersion) {
      throw new AppError('CONFLICT', 'The expense was modified by someone else', { currentVersion: expense.version });
    }
    if (opts.checkDuplicates && !opts.confirmDuplicate) {
      await opts.checkDuplicates(tx, loaded, expense as unknown as ExpenseBody, expense.payerUids ?? []);
    }
    const refundEffects = opts.refundEffects ? await opts.refundEffects(tx) : [];
    const ledgerChange = combineEffects(expense.ledgerEffect, ...refundEffects);
    if (opts.assertPreview) {
      await opts.assertPreview({ tx, loaded, expectedLedgerRevision: opts.expectedLedgerRevision, changes: [ledgerChange] });
    }
    const forProjection = {
      categoryId: expense.categoryId,
      payers: expense.payers,
      chargesByMember: expense.chargesByMember,
      viewerUids: expense.viewerUids ?? viewerUidsOf(expense),
      sharedTotalMinor: expense.sharedTotalMinor ?? 0,
    };
    const refundDeltas = opts.refundProjections ? (await opts.refundProjections(tx, forProjection)).map(refundAsExpense) : [];
    const ledger = await readLedger(tx, tripId);
    const projections = await readProjections(tx, tripId, affectedUids(forProjection, ...refundDeltas));

    const restored = { ...doc.data, status: 'active', voidedAt: null, restoredAt: ctx.now, updatedAt: ctx.now, version: expense.version + 1 };
    tx.set(expensePath(tripId, expenseId), restored, { updateTime: doc.updateTime });
    const next = writeTrip(tx, loaded.trip, {}, ctx.now);
    applyToLedger(tx, tripId, ledger, ledgerChange, next.version);
    writeProjectionsDelta(tx, tripId, projections, [
      { expense: forProjection, sign: 1 },
      ...refundDeltas.map((r) => ({ expense: r, sign: 1 as const, count: 0 as const })),
    ]);
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'expense.restore',
        entityType: 'expense',
        entityId: expenseId,
        beforeVersion: expense.version,
        afterVersion: expense.version + 1,
        correlationId: ctx.correlationId,
      },
      ctx.now,
    );
    return { expense: summary(expenseId, restored as unknown as ExpenseDoc) };
  });
}
