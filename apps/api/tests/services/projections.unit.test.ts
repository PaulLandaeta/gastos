import { describe, expect, it } from 'vitest';
import { applyExpense, rebuildProjections, type ExpenseForProjection, type RefundForProjection } from '../../src/services/projections.js';

const cena: ExpenseForProjection = {
  categoryId: 'default-food',
  payers: [{ uid: 'ana', amountMinor: 3000 }],
  chargesByMember: {
    ana: { sharedMinor: 1500, personalMinor: 0, netMinor: 1500 },
    pedro: { sharedMinor: 1500, personalMinor: 0, netMinor: 1500 },
  },
  viewerUids: ['ana', 'pedro'],
  sharedTotalMinor: 3000,
};

const refund: RefundForProjection = {
  categoryId: 'default-food',
  recipientUid: 'pedro',
  amountMinor: 1000,
  chargesDelta: { ana: 500, pedro: 500 },
  classification: 'shared',
  viewerUids: ['ana', 'pedro'],
};

describe('projections with refunds and edits', () => {
  it('a refund lowers consumption, shared total and the recipient contribution without changing expense count', () => {
    const p = rebuildProjections([cena], [refund]);
    expect(p.public).toEqual({ sharedTotalMinor: 2000, expenseCount: 1 });
    expect(p.categories.byCategory).toEqual({ 'default-food': 2000 });
    expect(p.memberStats['ana']).toMatchObject({ contributedMinor: 3000, sharedConsumedMinor: 1000, globalConsumedMinor: 1000 });
    expect(p.memberStats['pedro']).toMatchObject({ contributedMinor: -1000, sharedConsumedMinor: 1000, visibleExpenseCount: 1 });
  });

  it('an edit applied as −old +new equals the rebuild of the new state', () => {
    const edited: ExpenseForProjection = {
      ...cena,
      chargesByMember: { ana: { sharedMinor: 3000, personalMinor: 0, netMinor: 3000 } },
      viewerUids: ['ana'],
    };
    const p = rebuildProjections([cena], []);
    applyExpense(p, cena, -1);
    applyExpense(p, edited, 1);
    const expected = rebuildProjections([edited], []);
    expect(p.public).toEqual(expected.public);
    expect(p.categories).toEqual(expected.categories);
    expect(p.memberStats['ana']).toEqual(expected.memberStats['ana']);
    expect(p.memberStats['pedro']).toMatchObject({ sharedConsumedMinor: 0, visibleExpenseCount: 0, visibleSharedByCategory: {} });
  });
});
