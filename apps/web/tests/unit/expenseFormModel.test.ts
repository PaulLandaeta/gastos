import { describe, expect, it } from 'vitest';
import { evaluate, newDraft, toBody, type ExpenseDraft } from '../../src/features/expenses/expenseFormModel';

const members = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
  { uid: 'juan', joinOrder: 2 },
];

function simple(): ExpenseDraft {
  const d = newDraft({ meUid: 'ana', memberUids: members.map((m) => m.uid), today: '2026-11-01', categoryId: 'default-food' });
  d.description = 'Cena';
  d.totalMinor = 1000;
  return d;
}

describe('expense form model — US1 (total mode)', () => {
  it('new drafts default to: me as single payer, today, all members as beneficiaries, total mode', () => {
    const d = newDraft({ meUid: 'ana', memberUids: ['ana', 'pedro'], today: '2026-11-01', categoryId: 'default-other' });
    expect(d).toMatchObject({ splitMode: 'total', transactionDate: '2026-11-01', categoryId: 'default-other', singlePayer: true });
    expect(d.payers).toEqual([{ uid: 'ana', amountMinor: null }]);
    expect(d.items[0]!.beneficiaries).toEqual(['ana', 'pedro']);
  });

  it('maps an equal split to the API body with the single payer paying the total', () => {
    const body = toBody(simple());
    expect(body).toMatchObject({
      description: 'Cena',
      categoryId: 'default-food',
      transactionDate: '2026-11-01',
      totalMinor: 1000,
      splitMode: 'total',
      payers: [{ uid: 'ana', amountMinor: 1000 }],
      adjustments: [],
    });
    expect(body.items).toEqual([
      expect.objectContaining({ grossMinor: 1000, discountMinor: 0, classification: 'shared', allocation: { mode: 'equal' } }),
    ]);
  });

  it('previews the engine result with the provisional sequence number', () => {
    const r = evaluate(simple(), members, 1);
    expect(r.ok).toBe(true);
    expect(r.difference).toBe(0);
    expect(r.result!.chargesByMember['ana']!.netMinor).toBe(334);
    expect(evaluate(simple(), members, 2).result!.chargesByMember['pedro']!.netMinor).toBe(334);
  });

  it('blocks saving without description, total or beneficiaries', () => {
    const d = simple();
    d.description = '';
    d.totalMinor = null;
    d.items[0]!.beneficiaries = [];
    const r = evaluate(d, members, 1);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['DESCRIPTION', 'TOTAL', 'NO_BENEFICIARY']));
  });

  it('accepts transaction dates outside the trip range and an optional service period', () => {
    const d = simple();
    d.transactionDate = '2025-01-01';
    d.servicePeriod = { startDate: '2026-11-01', endDate: '2026-11-03' };
    expect(evaluate(d, members, 1).ok).toBe(true);
    expect(toBody(d).servicePeriod).toEqual({ startDate: '2026-11-01', endDate: '2026-11-03' });
    d.servicePeriod = { startDate: '2026-11-03', endDate: '2026-11-01' };
    expect(evaluate(d, members, 1).issues.map((i) => i.code)).toContain('SERVICE_PERIOD');
  });
});

import { assignInBulk, newItem } from '../../src/features/expenses/expenseFormModel';

function invoice(): ExpenseDraft {
  const d = newDraft({ meUid: 'pedro', memberUids: ['ana', 'pedro', 'juan'], today: '2026-11-02', categoryId: 'default-food' });
  d.description = 'Súper';
  d.splitMode = 'items';
  const pan = { ...newItem(['ana', 'pedro', 'juan']), description: 'Pan', grossMinor: 600 };
  const agua = { ...newItem(['ana', 'pedro', 'juan']), description: 'Agua', grossMinor: 300 };
  const champu = { ...newItem(['ana'], 'personal'), description: 'Champú', grossMinor: 1200 };
  const vino = { ...newItem(['ana', 'pedro', 'juan']), description: 'Vino', grossMinor: 900 };
  d.items = [pan, agua, champu, vino];
  d.totalMinor = 3000;
  return d;
}

describe('expense form model — US2 (items, bulk, adjustments, payers)', () => {
  it('bulk-assigns beneficiaries and then allows an individual fixed override', () => {
    let d = invoice();
    d = assignInBulk(d, [d.items[0]!.key, d.items[1]!.key, d.items[3]!.key], ['ana', 'pedro']);
    expect(d.items.filter((i) => i.classification === 'shared').every((i) => i.beneficiaries.join() === 'ana,pedro')).toBe(true);
    const vino = d.items[3]!;
    d.items[3] = { ...vino, mode: 'fixed', fixed: { ana: 600, pedro: 300 } };
    const r = evaluate(d, members, 1);
    expect(r.ok).toBe(true);
    expect(r.result!.chargesByMember['ana']).toMatchObject({ personalMinor: 1200, netMinor: 450 + 1200 + 600 });
    expect(r.result!.chargesByMember['juan']).toBeUndefined();
  });

  it('percentages must add up to exactly 100,00 %', () => {
    const d = invoice();
    d.items[3] = { ...d.items[3]!, beneficiaries: ['ana', 'pedro', 'juan'], mode: 'percent', percentBp: { ana: 3333, pedro: 3333, juan: 3333 } };
    expect(evaluate(d, members, 1).issues.map((i) => i.code)).toContain('PERCENT_SUM');
    d.items[3]!.percentBp = { ana: 3333, pedro: 3333, juan: 3334 };
    expect(evaluate(d, members, 1).ok).toBe(true);
  });

  it('a personal item keeps a single beneficiary even after bulk assignment', () => {
    let d = invoice();
    d = assignInBulk(d, d.items.map((i) => i.key), ['pedro', 'juan']);
    expect(d.items[2]!.beneficiaries).toEqual(['pedro']);
  });

  it('item discount + general discount + proportional tax + equal tip + manual adjustment balance once', () => {
    const d = invoice();
    d.items[0] = { ...d.items[0]!, discountMinor: 100 };
    d.adjustments = [
      { key: 'a1', kind: 'discount', amountMinor: 200, mode: 'proportional', manual: {} },
      { key: 'a2', kind: 'tax', amountMinor: 210, mode: 'proportional', manual: {} },
      { key: 'a3', kind: 'tip', amountMinor: 300, mode: 'equal', manual: {} },
      { key: 'a4', kind: 'tip', amountMinor: 50, mode: 'manual', manual: { ana: 50 } },
    ];
    d.totalMinor = 3000 - 100 - 200 + 210 + 300 + 50;
    const r = evaluate(d, members, 1);
    expect(r.difference).toBe(0);
    expect(r.ok).toBe(true);
    const sum = Object.values(r.result!.chargesByMember).reduce((a, c) => a + c.netMinor, 0);
    expect(sum).toBe(d.totalMinor);
  });

  it('reports the live difference and blocks saving until balanced; payers must add up', () => {
    const d = invoice();
    d.totalMinor = 3150;
    expect(evaluate(d, members, 1)).toMatchObject({ ok: false, difference: 150 });
    d.totalMinor = 3000;
    d.singlePayer = false;
    d.payers = [
      { uid: 'pedro', amountMinor: 2000 },
      { uid: 'ana', amountMinor: 900 },
    ];
    const r = evaluate(d, members, 1);
    expect(r).toMatchObject({ ok: false, payersDifference: 100 });
    expect(r.issues.map((i) => i.code)).toContain('PAYERS_DIFF');
    d.payers[1]!.amountMinor = 1000;
    expect(evaluate(d, members, 1).ok).toBe(true);
  });

  it('flags items without beneficiaries', () => {
    const d = invoice();
    d.items[1] = { ...d.items[1]!, beneficiaries: [] };
    const r = evaluate(d, members, 1);
    expect(r.issues.find((i) => i.code === 'NO_BENEFICIARY')?.itemKey).toBe(d.items[1]!.key);
  });

  it('150 items with bulk assignment recompute in < 50 ms', () => {
    let d = invoice();
    d.items = Array.from({ length: 150 }, (_, k) => ({ ...newItem(['ana', 'pedro', 'juan']), grossMinor: 101 + k }));
    d.totalMinor = d.items.reduce((a, i) => a + (i.grossMinor ?? 0), 0);
    d = assignInBulk(d, d.items.map((i) => i.key), ['ana', 'juan']);
    evaluate(d, members, 1);
    const t0 = performance.now();
    const r = evaluate(d, members, 9);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.ok).toBe(true);
  });
});
