import { describe, expect, it } from 'vitest';
import { CreateExpenseBody, RestoreExpenseBody, UpdateExpenseBody, VoidExpenseBody } from '../src/index.js';

const base = {
  description: 'Vino',
  transactionDate: '2026-11-01',
  categoryId: 'default-food',
  totalMinor: 3000,
  payers: [{ uid: 'a', amountMinor: 3000 }],
  splitMode: 'items',
  items: [{ id: 'v', index: 0, grossMinor: 3000, classification: 'shared', beneficiaries: ['a', 'b'], allocation: { mode: 'equal' } }],
};

describe('expense contracts v3', () => {
  it('items default to quantity 1 and accept positive integers only', () => {
    expect(CreateExpenseBody.parse(base).items[0]!.quantity).toBe(1);
    expect(CreateExpenseBody.parse({ ...base, items: [{ ...base.items[0], quantity: 3 }] }).items[0]!.quantity).toBe(3);
    expect(CreateExpenseBody.safeParse({ ...base, items: [{ ...base.items[0], quantity: 0 }] }).success).toBe(false);
    expect(CreateExpenseBody.safeParse({ ...base, items: [{ ...base.items[0], quantity: 1.5 }] }).success).toBe(false);
  });

  it('update requires expectedVersion; ledger revision optional', () => {
    expect(UpdateExpenseBody.safeParse(base).success).toBe(false);
    expect(UpdateExpenseBody.parse({ ...base, expectedVersion: 4 }).expectedVersion).toBe(4);
    expect(UpdateExpenseBody.parse({ ...base, expectedVersion: 4, expectedLedgerRevision: 7 }).expectedLedgerRevision).toBe(7);
  });

  it('void and restore bodies accept an optional ledger revision', () => {
    expect(VoidExpenseBody.parse({ expectedVersion: 1, expectedLedgerRevision: 2 })).toEqual({ expectedVersion: 1, expectedLedgerRevision: 2 });
    expect(RestoreExpenseBody.parse({ expectedVersion: 2, confirmDuplicate: true })).toMatchObject({ expectedVersion: 2, confirmDuplicate: true });
  });
});
