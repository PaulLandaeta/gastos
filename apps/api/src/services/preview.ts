import type { CreateExpenseBody } from 'contracts';
import { balancesPreview, combineEffects, computeExpense, negateEffect, type LedgerEffect, type Member } from 'finance-engine';
import type { z } from 'zod';
import type { Firestore, Transaction } from '../firestore/client.js';
import { AppError, notFound } from '../http/errors.js';
import { expensePath, type EditGuards, type ExpenseDoc } from './expenses.js';
import { readLedger } from './ledgerRepo.js';
import type { RefundForProjection } from './projections.js';
import { loadTripForMember, type LoadedTrip } from './tripRepo.js';
import { canViewExpense } from './visibility.js';

function membersOf(loaded: LoadedTrip): Member[] {
  return loaded.members
    .filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid)
    .map((m) => ({ uid: m.data.uid!, joinOrder: m.data.joinOrder ?? 0 }));
}

/** Ledger effects of the refunds of an expense (they count only while the expense is active). */
export async function refundEffectsOf(tx: Transaction, tripId: string, expenseId: string): Promise<LedgerEffect[]> {
  const docs = await tx.query(`${expensePath(tripId, expenseId)}/refunds`);
  return docs.map((d) => d.data['ledgerEffect'] as LedgerEffect);
}

/** Change to the ledger that an action on an expense produces (edit: −old +new; void/restore: ∓(expense + refunds)). */
export async function ledgerChangeFor(
  tx: Transaction,
  tripId: string,
  expenseId: string,
  expense: ExpenseDoc,
  action: 'edit' | 'void' | 'restore',
  members: Member[],
  editBody?: z.output<typeof CreateExpenseBody>,
): Promise<LedgerEffect> {
  if (action === 'edit') {
    const next = computeExpense({
      seq: expense.seq,
      totalMinor: editBody!.totalMinor,
      payers: editBody!.payers,
      splitMode: editBody!.splitMode,
      items: editBody!.items.map((i) => ({ ...i, discountMinor: i.discountMinor ?? 0 })) as Parameters<typeof computeExpense>[0]['items'],
      adjustments: editBody!.adjustments as Parameters<typeof computeExpense>[0]['adjustments'],
      members,
    });
    return combineEffects(negateEffect(expense.ledgerEffect), next.ledgerEffect);
  }
  const all = combineEffects(expense.ledgerEffect, ...(await refundEffectsOf(tx, tripId, expenseId)));
  return action === 'void' ? negateEffect(all) : all;
}

/** RF-28: balances before/after an edit, void or restore, without writing anything. */
export async function previewExpenseChange(
  db: Firestore,
  tripId: string,
  expenseId: string,
  uid: string,
  body: { action: 'edit'; body: z.output<typeof CreateExpenseBody> } | { action: 'void' | 'restore' },
) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, uid);
    const doc = await tx.get(expensePath(tripId, expenseId));
    if (!doc || !canViewExpense(loaded.me.data, doc.data as unknown as ExpenseDoc)) throw notFound('Expense');
    const members = membersOf(loaded);
    const change = await ledgerChangeFor(tx, tripId, expenseId, doc.data as unknown as ExpenseDoc, body.action, members, body.action === 'edit' ? body.body : undefined);
    const ledger = await readLedger(tx, tripId);
    return {
      ...balancesPreview(ledger.effect, [change], members),
      ledgerRevision: ledger.version,
      requiresConfirmation: (loaded.trip.data.confirmedSettlementCount ?? 0) > 0,
    };
  });
}

/**
 * FR-014 guard: with confirmed payments, the client must send the ledger revision it previewed;
 * without it → PREVIEW_REQUIRED (preview in details); a different revision → CONFLICT.
 */
export const assertPreviewAcknowledged: NonNullable<EditGuards['assertPreview']> = async ({ tx, loaded, expectedLedgerRevision, changes }) => {
  const ledger = await readLedger(tx, loaded.trip.id);
  const required = (loaded.trip.data.confirmedSettlementCount ?? 0) > 0;
  if (expectedLedgerRevision === undefined) {
    if (!required) return;
    throw new AppError('PREVIEW_REQUIRED', 'Review the impact on balances before confirming', {
      preview: { ...balancesPreview(ledger.effect, changes, membersOf(loaded)), ledgerRevision: ledger.version, requiresConfirmation: true },
    });
  }
  if (expectedLedgerRevision !== ledger.version) {
    throw new AppError('CONFLICT', 'Balances changed since the preview; recalculate', { currentLedgerRevision: ledger.version });
  }
};


/** Refunds of an expense as projection entries (category and viewers of the parent expense). */
export async function refundProjectionsOf(
  tx: Transaction,
  tripId: string,
  expenseId: string,
  expense: { categoryId: string; viewerUids: string[] },
): Promise<RefundForProjection[]> {
  const docs = await tx.query(`${expensePath(tripId, expenseId)}/refunds`);
  return docs.map((d) => ({
    categoryId: expense.categoryId,
    recipientUid: d.data['recipientUid'] as string,
    amountMinor: d.data['amountMinor'] as number,
    chargesDelta: d.data['chargesDelta'] as Record<string, number>,
    classification: d.data['classification'] as 'shared' | 'personal',
    viewerUids: expense.viewerUids,
  }));
}
