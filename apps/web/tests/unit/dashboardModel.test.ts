import { describe, expect, it } from 'vitest';
import { aggregate, applyFilters } from '../../src/features/dashboard/dashboardModel';
import type { ExpenseView } from '../../src/features/expenses/useExpenses';

function e(partial: Partial<ExpenseView>): ExpenseView {
  return {
    id: partial.id ?? 'x',
    seq: 1,
    description: 'd',
    transactionDate: '2026-11-01',
    categoryId: 'default-food',
    notes: null,
    servicePeriod: null,
    totalMinor: 0,
    payers: [],
    payerUids: [],
    beneficiaryUids: [],
    personalBeneficiaryUids: [],
    viewerUids: [],
    sharedTotalMinor: 0,
    personalTotalMinor: 0,
    chargesByMember: {},
    splitMode: 'total',
    items: [],
    adjustments: [],
    status: 'active',
    createdBy: 'ana',
    createdAt: new Date(),
    version: 1,
    ...partial,
  };
}

const expenses = [
  e({ id: 'cena', totalMinor: 900, sharedTotalMinor: 900, payers: [{ uid: 'ana', amountMinor: 900 }], payerUids: ['ana'], beneficiaryUids: ['ana', 'pedro', 'juan'],
      chargesByMember: { ana: { sharedMinor: 300, personalMinor: 0, netMinor: 300 }, pedro: { sharedMinor: 300, personalMinor: 0, netMinor: 300 }, juan: { sharedMinor: 300, personalMinor: 0, netMinor: 300 } } }),
  e({ id: 'taxi', transactionDate: '2026-11-03', categoryId: 'default-transport', totalMinor: 400, sharedTotalMinor: 400, payers: [{ uid: 'pedro', amountMinor: 400 }], payerUids: ['pedro'], beneficiaryUids: ['ana', 'pedro'],
      chargesByMember: { ana: { sharedMinor: 200, personalMinor: 0, netMinor: 200 }, pedro: { sharedMinor: 200, personalMinor: 0, netMinor: 200 } } }),
  e({ id: 'champu', categoryId: 'default-shopping', totalMinor: 120, personalTotalMinor: 120, payers: [{ uid: 'ana', amountMinor: 120 }], payerUids: ['ana'], beneficiaryUids: ['ana'], personalBeneficiaryUids: ['ana'],
      chargesByMember: { ana: { sharedMinor: 0, personalMinor: 120, netMinor: 120 } } }),
  e({ id: 'anulado', status: 'voided', totalMinor: 5000, sharedTotalMinor: 5000, payerUids: ['ana'], beneficiaryUids: ['ana'] }),
];

describe('dashboard model', () => {
  it('aggregates visible active expenses for the user; global = shared + personal', () => {
    const a = aggregate(expenses, 'ana');
    expect(a).toMatchObject({ sharedTotalMinor: 1300, contributedMinor: 1020, sharedConsumedMinor: 500, personalConsumedMinor: 120, globalConsumedMinor: 620, count: 3 });
    expect(a.byCategory).toEqual({ 'default-food': 900, 'default-transport': 400 });
    expect(Object.values(a.byCategory).reduce((x, y) => x + y, 0)).toBe(a.sharedTotalMinor);
  });

  it('filters by date range, category, person and payer', () => {
    expect(applyFilters(expenses, { from: '2026-11-02' }).map((x) => x.id)).toEqual(['taxi']);
    expect(applyFilters(expenses, { categoryId: 'default-food' }).map((x) => x.id)).toEqual(['cena']);
    expect(applyFilters(expenses, { personUid: 'juan' }).map((x) => x.id)).toEqual(['cena']);
    expect(applyFilters(expenses, { payerUid: 'pedro' }).map((x) => x.id)).toEqual(['taxi']);
    const filtered = aggregate(applyFilters(expenses, { personUid: 'pedro' }), 'pedro');
    expect(filtered).toMatchObject({ sharedTotalMinor: 1300, contributedMinor: 400, sharedConsumedMinor: 500 });
  });
});
