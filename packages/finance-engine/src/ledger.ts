import { EngineError, assertSafeMinor } from './money.js';
import type { LedgerEffect, Payment } from './types.js';

export const EMPTY_LEDGER: LedgerEffect = Object.freeze({
  netByMember: Object.freeze({}) as Record<string, number>,
  pairwise: Object.freeze({}) as Record<string, number>,
}) as LedgerEffect;

function addInto(target: Record<string, number>, source: Record<string, number>, sign: 1 | -1): void {
  for (const [key, value] of Object.entries(source)) {
    const next = (target[key] ?? 0) + sign * value;
    assertSafeMinor(next, key);
    if (next === 0) delete target[key];
    else target[key] = next;
  }
}

/** Sums ledger effects (they are additive). Zero entries are dropped. */
export function combineEffects(...effects: LedgerEffect[]): LedgerEffect {
  const netByMember: Record<string, number> = {};
  const pairwise: Record<string, number> = {};
  for (const e of effects) {
    addInto(netByMember, e.netByMember, 1);
    addInto(pairwise, e.pairwise, 1);
  }
  return { netByMember, pairwise };
}

/** Inverse effect, used when an expense is voided. */
export function negateEffect(effect: LedgerEffect): LedgerEffect {
  const netByMember: Record<string, number> = {};
  const pairwise: Record<string, number> = {};
  addInto(netByMember, effect.netByMember, -1);
  addInto(pairwise, effect.pairwise, -1);
  return { netByMember, pairwise };
}

/**
 * Effect of a payment. Only confirmed payments change balances (RF-21): the sender becomes
 * less of a debtor and the receiver now "owes back" the amount in the pairwise view.
 */
export function paymentEffect(payment: Payment): LedgerEffect {
  const { fromUid, toUid, amountMinor, status } = payment;
  assertSafeMinor(amountMinor, 'payment.amountMinor');
  if (amountMinor <= 0) throw new EngineError('INVALID_ALLOCATION', 'Payment amount must be positive');
  if (fromUid === toUid) throw new EngineError('INVALID_ALLOCATION', 'A payment needs two different members');
  if (status !== 'confirmed') return { netByMember: {}, pairwise: {} };
  return {
    netByMember: { [fromUid]: amountMinor, [toUid]: -amountMinor },
    pairwise: { [`${toUid}>${fromUid}`]: amountMinor },
  };
}

/** Rebuilds the ledger from scratch; MUST equal the incrementally maintained projection. */
export function rebuildLedger(activeExpenseEffects: LedgerEffect[], payments: Payment[]): LedgerEffect {
  return combineEffects(...activeExpenseEffects, ...payments.map(paymentEffect));
}
