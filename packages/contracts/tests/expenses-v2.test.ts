import { describe, expect, it } from 'vitest';
import { CreateExpenseBody, DEFAULT_CATEGORIES } from '../src/index.js';

const base = {
  description: 'Cena',
  transactionDate: '2026-11-01',
  totalMinor: 1000,
  payers: [{ uid: 'a', amountMinor: 1000 }],
  splitMode: 'total',
  items: [
    { id: 't', index: 0, grossMinor: 1000, classification: 'shared', beneficiaries: ['a'], allocation: { mode: 'equal' } },
  ],
  categoryId: 'default-food',
};

describe('CreateExpenseBody v2', () => {
  it('requires a category and accepts optional notes, service period and confirmDuplicate', () => {
    expect(CreateExpenseBody.safeParse({ ...base, categoryId: undefined }).success).toBe(false);
    const ok = CreateExpenseBody.parse({
      ...base,
      notes: 'mesa 4',
      servicePeriod: { startDate: '2026-11-01', endDate: '2026-11-03' },
      confirmDuplicate: true,
    });
    expect(ok.servicePeriod).toEqual({ startDate: '2026-11-01', endDate: '2026-11-03' });
    expect(ok.adjustments).toEqual([]);
  });

  it('rejects notes over 500 chars and inverted service periods', () => {
    expect(CreateExpenseBody.safeParse({ ...base, notes: 'x'.repeat(501) }).success).toBe(false);
    expect(
      CreateExpenseBody.safeParse({ ...base, servicePeriod: { startDate: '2026-11-03', endDate: '2026-11-01' } }).success,
    ).toBe(false);
  });
});

describe('DEFAULT_CATEGORIES', () => {
  it('has the 6 initial categories with deterministic ids', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.id)).toEqual([
      'default-lodging',
      'default-transport',
      'default-food',
      'default-activities',
      'default-shopping',
      'default-other',
    ]);
    expect(DEFAULT_CATEGORIES.map((c) => c.name)).toEqual([
      'Alojamiento',
      'Transporte',
      'Comida',
      'Actividades',
      'Compras',
      'Otros',
    ]);
    for (const c of DEFAULT_CATEGORIES) expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
