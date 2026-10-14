import { describe, expect, it } from 'vitest';
import { computeExpense, type ExpenseInput, type Member } from '../../src/index.js';

/** Plan performance goal: one expense with 100 items × 50 members in < 2 ms (Workers CPU budget). */
describe('rendimiento del motor', () => {
  it('100 ítems × 50 miembros en menos de 2 ms (mediana)', () => {
    const members: Member[] = Array.from({ length: 50 }, (_, i) => ({ uid: `m${i}`, joinOrder: i }));
    const uids = members.map((m) => m.uid);
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `i${index}`,
      index,
      grossMinor: 12_345 + index,
      discountMinor: index % 7,
      classification: 'shared' as const,
      beneficiaries: uids,
      allocation: { mode: 'equal' as const },
    }));
    const itemsNet = items.reduce((a, i) => a + i.grossMinor - i.discountMinor, 0);
    const total = itemsNet + 9_999 + 5_000;
    const input: ExpenseInput = {
      seq: 7,
      totalMinor: total,
      payers: [
        { uid: 'm0', amountMinor: total - 100_000 },
        { uid: 'm1', amountMinor: 100_000 },
      ],
      splitMode: 'items',
      items,
      adjustments: [
        { kind: 'tax', amountMinor: 9_999, mode: 'proportional' },
        { kind: 'tip', amountMinor: 5_000, mode: 'equal' },
      ],
      members,
    };

    for (let i = 0; i < 20; i++) computeExpense(input); // warm-up (JIT)
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      computeExpense(input);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median).toBeLessThan(2);
  });
});
