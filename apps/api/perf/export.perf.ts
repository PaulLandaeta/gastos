import { originalDebts, simplifiedDebts, type LedgerEffect, type Member } from 'finance-engine';
import { describe, expect, it } from 'vitest';
import { decodeFields, encodeFields } from '../src/firestore/codec.js';
import { toExportExpense } from '../src/services/exports.js';

/** Median wall time (ms) after warm-up; synchronous work ≈ CPU time. */
function median(fn: () => unknown, runs = 30): number {
  for (let i = 0; i < 5; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(runs / 2)]!;
}

const members: Member[] = Array.from({ length: 10 }, (_, i) => ({ uid: `u${i}`, joinOrder: i }));
const uids = members.map((m) => m.uid);

/** Firestore REST `runQuery` body for one page: 100 expenses with 5 items and 10 people each. */
function restPage(): string {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    document: {
      name: `projects/p/databases/(default)/documents/trips/t1/expenses/e${i}`,
      fields: encodeFields({
        seq: i + 1,
        description: `Gasto número ${i + 1} con una descripción normal`,
        transactionDate: '2026-11-02',
        categoryId: 'default-food',
        totalMinor: 123_456,
        sharedTotalMinor: 100_000,
        personalTotalMinor: 23_456,
        payers: [{ uid: 'u0', amountMinor: 100_000 }, { uid: 'u1', amountMinor: 23_456 }],
        chargesByMember: Object.fromEntries(uids.map((u) => [u, { sharedMinor: 10_000, personalMinor: 2_345, netMinor: 12_345 }])),
        items: Array.from({ length: 5 }, (_, k) => ({ id: `i${k}`, description: `Ítem ${k}`, grossMinor: 24_691, discountMinor: 0, quantity: 2, classification: 'shared', beneficiaries: uids, allocation: { mode: 'equal' } })),
        adjustments: [{ kind: 'tip', amountMinor: 1000, mode: 'proportional' }],
        viewerUids: uids,
        status: 'active',
        createdAt: new Date(),
      }),
      createTime: '2026-11-02T00:00:00Z',
      updateTime: '2026-11-02T00:00:00Z',
    },
  }));
  return JSON.stringify(rows);
}

describe('export CPU budget per page (feature 005, SC-007)', () => {
  it('a page of 100 expenses (parse REST + filter + map + serialize) stays below 5 ms (50 % headroom)', () => {
    const body = restPage();
    const ms = median(() => {
      const rows = JSON.parse(body) as { document: { name: string; fields: Record<string, never> } }[];
      const page = rows.map((r) => {
        const data = decodeFields(r.document.fields);
        const path = r.document.name.split('/documents/')[1]!;
        return toExportExpense({ id: path.split('/').at(-1)!, path, data, createTime: '', updateTime: '' });
      });
      return JSON.stringify({ expenses: page.filter((e) => e.status === 'active'), voidedExpenses: [], refunds: [], nextCursor: 'x' });
    });
    console.log(JSON.stringify({ exportPageMs: ms.toFixed(3) }));
    expect(ms).toBeLessThan(5);
  });

  it('the first page header work (debts in both views for 10 people) is negligible', () => {
    const effect: LedgerEffect = { netByMember: Object.fromEntries(uids.map((u, i) => [u, i === 9 ? -4500 : 500])), pairwise: {} };
    const ms = median(() => [originalDebts(effect, members), simplifiedDebts(effect, members)]);
    console.log(JSON.stringify({ exportHeaderMs: ms.toFixed(3) }));
    expect(ms).toBeLessThan(2);
  });
});
