import { describe, expect, it } from 'vitest';
import { diffDraft, fromExpense } from '../../src/features/expenses/expenseEditModel';
import { evaluate, toBody } from '../../src/features/expenses/expenseFormModel';
import type { ExpenseView } from '../../src/features/expenses/useExpenses';

const members = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
];

const stored = {
  id: 'e1', seq: 3, description: 'Súper', transactionDate: '2026-11-02', categoryId: 'default-food', notes: 'ticket',
  servicePeriod: null, totalMinor: 1310, payers: [{ uid: 'pedro', amountMinor: 1310 }], payerUids: ['pedro'],
  beneficiaryUids: ['ana', 'pedro'], personalBeneficiaryUids: ['ana'], viewerUids: ['ana', 'pedro'], sharedTotalMinor: 0,
  personalTotalMinor: 0, chargesByMember: {}, splitMode: 'items',
  items: [
    { id: 'pan', index: 0, description: 'Pan', grossMinor: 600, discountMinor: 0, quantity: 2, classification: 'shared', beneficiaries: ['ana', 'pedro'], allocation: { mode: 'equal' } },
    { id: 'cha', index: 1, description: 'Champú', grossMinor: 700, discountMinor: 0, quantity: 1, classification: 'personal', beneficiaries: ['ana'], allocation: { mode: 'equal' } },
  ],
  adjustments: [{ kind: 'tip', amountMinor: 10, mode: 'equal' }], status: 'active', createdBy: 'pedro', createdAt: new Date(), version: 4,
} as unknown as ExpenseView;

describe('edit model', () => {
  it('fromExpense round-trips to the same API body (items keep ids and quantity)', () => {
    const draft = fromExpense(stored);
    const body = toBody(draft);
    expect(body).toMatchObject({ description: 'Súper', categoryId: 'default-food', totalMinor: 1310, splitMode: 'items', notes: 'ticket' });
    expect(body.items.map((i) => [i.id, i.quantity])).toEqual([['pan', 2], ['cha', 1]]);
    expect(body.payers).toEqual([{ uid: 'pedro', amountMinor: 1310 }]);
    expect(evaluate(draft, members, stored.seq).ok).toBe(true);
  });

  it('diffDraft lists the fields that differ from the current version', () => {
    const draft = fromExpense(stored);
    draft.description = 'Súper (corregido)';
    const current = { ...stored, totalMinor: 1410, items: stored.items.map((i) => (i.id === 'pan' ? { ...i, grossMinor: 700 } : i)) } as ExpenseView;
    expect(diffDraft(draft, current).map((d) => d.field)).toEqual(['description', 'totalMinor', 'items']);
    expect(diffDraft(fromExpense(stored), stored)).toEqual([]);
  });
});
