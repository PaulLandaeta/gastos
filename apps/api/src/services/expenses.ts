import type { CreateExpenseBody } from 'contracts';
import {
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
import { affectedUids, readProjections, writeExpenseToProjections } from './projections.js';
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

/** Expense document schema version written by feature 002. */
export const EXPENSE_SCHEMA_VERSION = 2;

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

/** Hook for duplicate detection (US7); returns normally when the expense may be saved. */
export type DuplicateCheck = (
  tx: Transaction,
  loaded: LoadedTrip,
  body: ExpenseBody,
  payerUids: string[],
) => Promise<void>;

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
    const input: ExpenseInput = {
      seq,
      totalMinor: body.totalMinor,
      payers: body.payers,
      splitMode: body.splitMode,
      items: body.items.map((i) => ({ ...i, discountMinor: i.discountMinor ?? 0 })) as ExpenseInput['items'],
      adjustments: body.adjustments as ExpenseInput['adjustments'],
      members: engineMembers(loaded),
    };
    const computed = computeExpense(input);

    const payerUids = sortedUnique(body.payers.map((p) => p.uid));
    if (checkDuplicates && !body.confirmDuplicate) await checkDuplicates(tx, loaded, body, payerUids);

    const charges = Object.values(computed.chargesByMember);
    const viewerUids = viewerUidsOf({ createdBy: ctx.actorUid, payers: body.payers, items: body.items });
    const expenseId = newId();
    const expense = {
      seq,
      description: body.description,
      transactionDate: body.transactionDate,
      categoryId: body.categoryId,
      notes: body.notes ?? null,
      servicePeriod: body.servicePeriod ?? null,
      currency: trip.data.currency,
      totalMinor: body.totalMinor,
      payers: body.payers,
      payerUids,
      splitMode: body.splitMode,
      items: input.items,
      adjustments: input.adjustments,
      beneficiaryUids: sortedUnique(body.items.flatMap((i) => i.beneficiaries)),
      personalBeneficiaryUids: sortedUnique(
        body.items.filter((i) => i.classification === 'personal').flatMap((i) => i.beneficiaries),
      ),
      viewerUids,
      sharedTotalMinor: charges.reduce((a, c) => a + c.sharedMinor, 0),
      personalTotalMinor: charges.reduce((a, c) => a + c.personalMinor, 0),
      chargesByMember: computed.chargesByMember,
      ledgerEffect: computed.ledgerEffect,
      duplicateConfirmed: body.confirmDuplicate === true,
      status: 'active' as const,
      createdBy: ctx.actorUid,
      idempotencyKey,
      recordedAt: ctx.now,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      voidedAt: null,
      schemaVersion: EXPENSE_SCHEMA_VERSION,
      version: 1,
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
    const ledger = await readLedger(tx, tripId);
    const forProjection = {
      categoryId: expense.categoryId,
      payers: expense.payers,
      chargesByMember: expense.chargesByMember,
      viewerUids: expense.viewerUids ?? viewerUidsOf(expense),
      sharedTotalMinor: expense.sharedTotalMinor ?? 0,
    };
    const hasProjection = expense.categoryId !== undefined;
    const projections = hasProjection ? await readProjections(tx, tripId, affectedUids(forProjection)) : null;

    tx.set(expensePath(tripId, expenseId), voided, { updateTime: doc.updateTime });
    const next = writeTrip(tx, loaded.trip, {}, ctx.now);
    applyToLedger(tx, tripId, ledger, negateEffect(expense.ledgerEffect), next.version);
    if (projections) writeExpenseToProjections(tx, tripId, projections, forProjection, -1);
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
