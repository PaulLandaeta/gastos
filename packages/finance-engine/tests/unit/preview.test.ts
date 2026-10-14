import { describe, expect, it } from 'vitest';
import { balancesPreview, negateEffect, type LedgerEffect, type Member } from '../../src/index.js';

const members: Member[] = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
  { uid: 'juan', joinOrder: 2 },
];

describe('balancesPreview', () => {
  it('returns before, after and delta for every member in join order', () => {
    const ledger: LedgerEffect = { netByMember: { ana: 1000, pedro: -1000 }, pairwise: { 'pedro>ana': 1000 } };
    const change: LedgerEffect = { netByMember: { ana: -400, juan: 400 }, pairwise: { 'ana>juan': 400 } };
    const p = balancesPreview(ledger, [change], members);
    expect(p.before).toEqual([
      { uid: 'ana', netMinor: 1000 },
      { uid: 'pedro', netMinor: -1000 },
      { uid: 'juan', netMinor: 0 },
    ]);
    expect(p.after).toEqual([
      { uid: 'ana', netMinor: 600 },
      { uid: 'pedro', netMinor: -1000 },
      { uid: 'juan', netMinor: 400 },
    ]);
    expect(p.delta.map((d) => d.netMinor)).toEqual([-400, 0, 400]);
    expect(p.delta.reduce((a, d) => a + d.netMinor, 0)).toBe(0);
  });

  it('applying a change and its negation leaves balances unchanged', () => {
    const ledger: LedgerEffect = { netByMember: { ana: 50, juan: -50 }, pairwise: { 'juan>ana': 50 } };
    const change: LedgerEffect = { netByMember: { ana: 10, pedro: -10 }, pairwise: { 'pedro>ana': 10 } };
    const p = balancesPreview(ledger, [change, negateEffect(change)], members);
    expect(p.after).toEqual(p.before);
  });
});
