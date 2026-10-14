import { SCHEMA_VERSION } from 'contracts';
import { itemChargesByMember, itemRefundable, refundEffect, suggestRefund, type ExpenseInput, type Member } from 'finance-engine';
import type { Firestore, Transaction } from '../firestore/client.js';
import { AppError, notFound } from '../http/errors.js';
import { writeAudit } from './audit.js';
import { expensePath, type ExpenseDoc } from './expenses.js';
import { findIdempotent, idempotencyPath, recordIdempotent } from './idempotency.js';
import { applyToLedger, readLedger } from './ledgerRepo.js';
import { affectedUids, readProjections, refundAsExpense, writeProjectionsDelta } from './projections.js';
import { actorName, notificationsFor, writeNotifications } from './notifications.js';
import { assertMutable, loadTripForMember, newId, tripRefOf, writeTrip, type LoadedTrip, type MutationContext } from './tripRepo.js';
import { canViewExpense, viewerUidsOf } from './visibility.js';

type StoredExpense = Omit<ExpenseDoc, 'items'> & {
  categoryId: string;
  splitMode: 'total' | 'items';
  items: (ExpenseInput['items'][number] & { quantity?: number })[];
  adjustments: ExpenseInput['adjustments'];
  refundedByItem?: Record<string, { quantity: number; amountMinor: number }>;
};

function membersOf(loaded: LoadedTrip): Member[] {
  return loaded.members
    .filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid)
    .map((m) => ({ uid: m.data.uid!, joinOrder: m.data.joinOrder ?? 0 }));
}

export function engineInputOf(e: StoredExpense, members: Member[]): ExpenseInput {
  return {
    seq: e.seq,
    totalMinor: e.totalMinor,
    payers: e.payers,
    splitMode: e.splitMode,
    items: e.items.map((i) => ({ ...i, discountMinor: i.discountMinor ?? 0 })),
    adjustments: e.adjustments ?? [],
    members,
  };
}

/** Max refundable of an item for edit constraints (feature 003, US5). */
export const maxRefundableOf = (input: ExpenseInput, itemId: string, quantity: number) => itemRefundable(input, itemId, quantity).maxMinor;

async function loadVisibleExpense(tx: Transaction, tripId: string, expenseId: string, loaded: LoadedTrip) {
  const doc = await tx.get(expensePath(tripId, expenseId));
  if (!doc || !canViewExpense(loaded.me.data, doc.data as unknown as ExpenseDoc)) throw notFound('Expense');
  return { doc, expense: doc.data as unknown as StoredExpense };
}

function refundableFor(expense: StoredExpense, members: Member[], itemId: string) {
  const item = expense.items.find((i) => i.id === itemId);
  if (!item) throw new AppError('VALIDATION_FAILED', 'Invalid request', { fields: { itemId: 'Unknown item' } });
  const input = engineInputOf(expense, members);
  const r = itemRefundable(input, itemId, item.quantity ?? 1);
  const already = expense.refundedByItem?.[itemId] ?? { quantity: 0, amountMinor: 0 };
  return { item, input, r, already };
}

export async function getRefundable(db: Firestore, tripId: string, expenseId: string, itemId: string, quantity: number, uid: string) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, uid);
    const { expense } = await loadVisibleExpense(tx, tripId, expenseId, loaded);
    const { r, already } = refundableFor(expense, membersOf(loaded), itemId);
    return {
      quantity: r.quantity,
      refundedQuantity: already.quantity,
      maxMinor: r.maxMinor,
      refundedMinor: already.amountMinor,
      suggestedMinor: quantity > 0 ? suggestRefund(r, already, quantity) : 0,
    };
  });
}

/**
 * RF-37: refund (total or partial) of an item as a compensating movement; the original expense
 * amounts are never mutated, only `refundedByItem` (limits) and the refunds subcollection.
 */
export async function createRefund(
  db: Firestore,
  tripId: string,
  expenseId: string,
  body: { itemId: string; quantity: number; amountMinor: number; recipientUid: string },
  idempotencyKey: string,
  ctx: MutationContext,
) {
  const idemPath = idempotencyPath(tripId, ctx.actorUid, idempotencyKey);
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    // Q3: payers, beneficiaries, author (= viewers) and managers may register refunds.
    const { doc, expense } = await loadVisibleExpense(tx, tripId, expenseId, loaded);
    const previous = await findIdempotent(tx, idemPath);
    if (previous) {
      const existing = await tx.get(`${expensePath(tripId, expenseId)}/refunds/${previous.resultRef}`);
      if (!existing) throw new AppError('CONFLICT', 'Idempotency key refers to a missing refund');
      return { refund: { id: existing.id, ...(existing.data as Record<string, unknown>) }, expense: { id: expenseId, version: expense.version } };
    }
    if (expense.status !== 'active') throw new AppError('INVALID_TRANSITION', 'Refunds require an active expense');
    const members = membersOf(loaded);
    if (!members.some((m) => m.uid === body.recipientUid)) {
      throw new AppError('VALIDATION_FAILED', 'Invalid request', { fields: { recipientUid: 'Must be a trip participant' } });
    }
    const { item, input, r, already } = refundableFor(expense, members, body.itemId);
    if (already.quantity + body.quantity > r.quantity || already.amountMinor + body.amountMinor > r.maxMinor) {
      throw new AppError('REFUND_EXCEEDS', 'The refund exceeds what is refundable', {
        maxQuantity: r.quantity - already.quantity,
        maxMinor: r.maxMinor - already.amountMinor,
      });
    }
    const effect = refundEffect({
      amountMinor: body.amountMinor,
      recipientUid: body.recipientUid,
      itemCharges: itemChargesByMember(input, body.itemId),
      rotation: expense.seq - 1 + item.index,
      members,
    });
    const refundId = newId();
    const refund = {
      itemId: body.itemId,
      quantity: body.quantity,
      amountMinor: body.amountMinor,
      recipientUid: body.recipientUid,
      classification: item.classification,
      chargesDelta: effect.chargesDelta,
      ledgerEffect: effect.ledgerEffect,
      createdBy: ctx.actorUid,
      createdAt: ctx.now,
      idempotencyKey,
      schemaVersion: SCHEMA_VERSION,
      version: 1,
    };
    const viewerUids = expense.viewerUids ?? viewerUidsOf(expense);
    const asExpense = refundAsExpense({ ...refund, categoryId: expense.categoryId, viewerUids });
    const ledger = await readLedger(tx, tripId);
    const projections = await readProjections(tx, tripId, affectedUids(asExpense));

    tx.set(`${expensePath(tripId, expenseId)}/refunds/${refundId}`, refund, { exists: false });
    const refundedByItem = {
      ...(expense.refundedByItem ?? {}),
      [body.itemId]: { quantity: already.quantity + body.quantity, amountMinor: already.amountMinor + body.amountMinor },
    };
    tx.set(expensePath(tripId, expenseId), { ...doc.data, refundedByItem, updatedAt: ctx.now, version: expense.version + 1 }, { updateTime: doc.updateTime });
    const next = writeTrip(tx, loaded.trip, {}, ctx.now);
    applyToLedger(tx, tripId, ledger, effect.ledgerEffect, next.version);
    writeProjectionsDelta(tx, tripId, projections, [{ expense: asExpense, sign: 1, count: 0 }]);
    recordIdempotent(tx, idemPath, { operation: 'refund.create', resultRef: refundId }, ctx.now);
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'refund.create',
        entityType: 'expense',
        entityId: expenseId,
        beforeVersion: expense.version,
        afterVersion: expense.version + 1,
        correlationId: ctx.correlationId,
        diff: { itemId: body.itemId, quantity: body.quantity },
      },
      ctx.now,
    );
    const recipient = loaded.members.find((m) => m.data.uid === body.recipientUid)!.data;
    writeNotifications(
      tx,
      notificationsFor({
        kind: 'refund.received',
        trip: tripRefOf(loaded.trip),
        actor: { uid: ctx.actorUid, name: actorName(loaded.members, ctx.actorUid) },
        expenseId,
        recipientUid: body.recipientUid,
        amountMinor: body.amountMinor,
        expenseDescription: expense.description,
        recipientCanView: canViewExpense(recipient, expense),
      }),
      ctx.now,
    );
    const { ledgerEffect: _l, ...dto } = refund;
    return { refund: { id: refundId, ...dto }, expense: { id: expenseId, version: expense.version + 1 } };
  });
}
