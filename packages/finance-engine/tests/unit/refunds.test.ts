import { describe, expect, it } from 'vitest';
import {
  combineEffects,
  computeExpense,
  itemAdjustmentShares,
  itemChargesByMember,
  itemRefundable,
  originalDebts,
  refundEffect,
  suggestRefund,
  type ExpenseInput,
  type Member,
} from '../../src/index.js';

const members: Member[] = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
];

function vino(adjustments: ExpenseInput['adjustments'] = []): ExpenseInput {
  const tax = adjustments.reduce((a, x) => a + (x.kind === 'discount' ? -x.amountMinor : x.amountMinor), 0);
  return {
    seq: 1,
    totalMinor: 3000 + 1000 + tax,
    payers: [{ uid: 'ana', amountMinor: 3000 + 1000 + tax }],
    splitMode: 'items',
    items: [
      { id: 'vino', index: 0, grossMinor: 3000, discountMinor: 0, classification: 'shared', beneficiaries: ['ana', 'pedro'], allocation: { mode: 'equal' } },
      { id: 'champu', index: 1, grossMinor: 1000, discountMinor: 0, classification: 'personal', beneficiaries: ['ana'], allocation: { mode: 'equal' } },
    ],
    adjustments,
    members,
  };
}

describe('refund helpers', () => {
  it('splits general adjustments among items in proportion to their net', () => {
    expect(itemAdjustmentShares(vino([{ kind: 'tax', amountMinor: 400, mode: 'proportional' }]))).toEqual({ vino: 300, champu: 100 });
    expect(itemAdjustmentShares(vino())).toEqual({ vino: 0, champu: 0 });
  });

  it('itemRefundable = item net + its share of general adjustments', () => {
    expect(itemRefundable(vino([{ kind: 'tax', amountMinor: 400, mode: 'proportional' }]), 'vino', 3)).toEqual({
      quantity: 3,
      netMinor: 3000,
      adjustmentShareMinor: 300,
      maxMinor: 3300,
    });
    expect(() => itemRefundable(vino(), 'nope', 1)).toThrow();
  });

  it('suggestRefund is proportional by quantity and the last unit takes the residue', () => {
    const r = { quantity: 3, netMinor: 1000, adjustmentShareMinor: 0, maxMinor: 1000 };
    expect(suggestRefund(r, { quantity: 0, amountMinor: 0 }, 1)).toBe(333);
    expect(suggestRefund(r, { quantity: 1, amountMinor: 333 }, 1)).toBe(333);
    expect(suggestRefund(r, { quantity: 2, amountMinor: 666 }, 1)).toBe(334);
    expect(suggestRefund(r, { quantity: 0, amountMinor: 0 }, 3)).toBe(1000);
  });

  it('itemChargesByMember returns the item allocation per beneficiary', () => {
    expect(itemChargesByMember(vino(), 'vino')).toEqual({ ana: 1500, pedro: 1500 });
    expect(itemChargesByMember(vino(), 'champu')).toEqual({ ana: 1000 });
  });
});

describe('refundEffect', () => {
  it('quickstart: 1 of 3 units (10.00) received by Pedro → each consumes 5.00 less; Pedro owes Ana 5.00', () => {
    const input = vino();
    const base = computeExpense(input).ledgerEffect; // ana paid 4000: ana +1500, pedro −1500
    const r = refundEffect({ amountMinor: 1000, recipientUid: 'pedro', itemCharges: itemChargesByMember(input, 'vino'), rotation: 0, members });
    expect(r.chargesDelta).toEqual({ ana: 500, pedro: 500 });
    expect(r.ledgerEffect.netByMember).toEqual({ ana: 500, pedro: -500 });
    expect(r.ledgerEffect.pairwise).toEqual({ 'pedro>ana': 500 });
    const after = combineEffects(base, r.ledgerEffect);
    expect(after.netByMember).toEqual({ ana: 2000, pedro: -2000 });
    expect(originalDebts(after, members)).toEqual([{ fromUid: 'pedro', toUid: 'ana', amountMinor: 2000 }]);
  });

  it('is zero-sum and rotation-deterministic with uneven splits', () => {
    const r = refundEffect({ amountMinor: 1001, recipientUid: 'ana', itemCharges: { ana: 1, pedro: 1 }, rotation: 1, members });
    expect(Object.values(r.chargesDelta).reduce((a, b) => a + b, 0)).toBe(1001);
    expect(r.chargesDelta).toEqual({ ana: 500, pedro: 501 });
    expect(Object.values(r.ledgerEffect.netByMember).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('falls back to equal shares when the item had no charges and rejects bad input', () => {
    expect(refundEffect({ amountMinor: 10, recipientUid: 'ana', itemCharges: { ana: 0, pedro: 0 }, rotation: 0, members }).chargesDelta).toEqual({ ana: 5, pedro: 5 });
    expect(() => refundEffect({ amountMinor: 0, recipientUid: 'ana', itemCharges: { ana: 1 }, rotation: 0, members })).toThrow();
    expect(() => refundEffect({ amountMinor: 5, recipientUid: 'eve', itemCharges: { ana: 1 }, rotation: 0, members })).toThrow();
    expect(() => refundEffect({ amountMinor: 5, recipientUid: 'ana', itemCharges: {}, rotation: 0, members })).toThrow();
  });
});
