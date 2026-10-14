import { SCHEMA_VERSION, type CreateExpenseBody } from 'contracts';
import { computeExpense, negateEffect, type ExpenseInput, type LedgerEffect, type Member } from 'finance-engine';
import type { z } from 'zod';
import type { Firestore } from '../firestore/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { writeAudit } from './audit.js';
import { findIdempotent, idempotencyPath, recordIdempotent } from './idempotency.js';
import { applyToLedger, readLedger } from './ledgerRepo.js';
import {
  assertMutable,
  loadTripForMember,
  newId,
  toTripDto,
  writeTrip,
  type LoadedTrip,
  type MutationContext,
} from './tripRepo.js';

type ExpenseBody = z.output<typeof CreateExpenseBody>;

interface ExpenseDoc {
  seq: number;
  totalMinor: number;
  status: 'active' | 'voided';
  createdBy: string;
  ledgerEffect: LedgerEffect;
  version: number;
}

const expensePath = (tripId: string, expenseId: string) => `trips/${tripId}/expenses/${expenseId}`;

const summary = (id: string, e: ExpenseDoc) => ({
  id,
  seq: e.seq,
  totalMinor: e.totalMinor,
  status: e.status,
  version: e.version,
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

/**
 * Service-level expense registration (FR-028). Validates with the finance engine, assigns the
 * immutable sequence number, locks currency/participants on the first expense (FR-027) and
 * updates the incremental ledger, all in one transaction.
 */
export async function createExpense(
  db: Firestore,
  tripId: string,
  body: ExpenseBody,
  idempotencyKey: string,
  ctx: MutationContext,
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
      // Same key again: replay the original result, no new effect (idempotency).
      return { expense: summary(existing.id, existing.data as unknown as ExpenseDoc), trip: toTripDto(tripId, trip.data) };
    }

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
    const ledger = await readLedger(tx, tripId);

    const expenseId = newId();
    const expense = {
      seq,
      description: body.description,
      transactionDate: body.transactionDate,
      currency: trip.data.currency,
      totalMinor: body.totalMinor,
      payers: body.payers,
      splitMode: body.splitMode,
      items: input.items,
      adjustments: input.adjustments,
      chargesByMember: computed.chargesByMember,
      ledgerEffect: computed.ledgerEffect,
      status: 'active' as const,
      createdBy: ctx.actorUid,
      idempotencyKey,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      voidedAt: null,
      schemaVersion: SCHEMA_VERSION,
      version: 1,
    };
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
        diff: { seq, totalMinor: body.totalMinor, items: body.items.length },
      },
      ctx.now,
    );
    return { expense: summary(expenseId, expense), trip: toTripDto(tripId, next) };
  });
}

/** Soft delete (RF-29): subtracts the stored ledger effect; locks stay in place (RF-55). */
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
    const role = loaded.me.data.role;
    if (expense.createdBy !== ctx.actorUid && role !== 'creator' && role !== 'admin') {
      throw forbidden('Only the author, the creator or an admin can void an expense');
    }
    if (expense.version !== expectedVersion) {
      throw new AppError('CONFLICT', 'The expense was modified by someone else', { currentVersion: expense.version });
    }
    if (expense.status !== 'active') throw new AppError('INVALID_TRANSITION', 'The expense is already voided');

    const voided = { ...doc.data, status: 'voided', voidedAt: ctx.now, updatedAt: ctx.now, version: expense.version + 1 };
    tx.set(expensePath(tripId, expenseId), voided, { updateTime: doc.updateTime });
    const ledger = await readLedger(tx, tripId);
    const next = writeTrip(tx, loaded.trip, {}, ctx.now);
    applyToLedger(tx, tripId, ledger, negateEffect(expense.ledgerEffect), next.version);
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
