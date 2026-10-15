import { describe, expect, it } from 'vitest';
import {
  EngineError,
  originalDebts,
  roastRanking,
  simplifiedDebts,
  type LedgerEffect,
  type Member,
} from '../../src/index.js';

const members = (...uids: string[]): Member[] => uids.map((uid, joinOrder) => ({ uid, joinOrder }));
const nets = (o: Record<string, number>) => Object.entries(o).map(([uid, netMinor]) => ({ uid, netMinor }));
const tiers = (entries: ReturnType<typeof roastRanking>) => entries.map((e) => [e.uid, e.tier]);

describe('roastRanking tiers (feature 007, US1)', () => {
  const group = members('ana', 'beto', 'carla', 'dani', 'eva');

  it('labels the spec example and orders by debt, then the creditors', () => {
    const r = roastRanking(nets({ ana: 15000, beto: -12000, carla: -7000, dani: -1500, eva: 5500 }), [], group);
    expect(tiers(r)).toEqual([
      ['beto', 'top'],
      ['carla', 'golfa'],
      ['dani', 'senorita'],
      ['ana', 'macho'],
      ['eva', 'macho'],
    ]);
    expect(r.map((e) => e.debtMinor)).toEqual([12000, 7000, 1500, 0, 0]);
  });

  it('has a single top on a tie, chosen by join order; the other is golfa', () => {
    const r = roastRanking(nets({ ana: 200, carla: -100, beto: -100 }), [], group);
    expect(tiers(r)).toEqual([
      ['beto', 'top'],
      ['carla', 'golfa'],
      ['ana', 'macho'],
    ]);
  });

  it('exactly 50 % of the top debt is señorita', () => {
    const r = roastRanking(nets({ ana: 150, beto: -100, carla: -50 }), [], group);
    expect(tiers(r)).toEqual([
      ['beto', 'top'],
      ['carla', 'senorita'],
      ['ana', 'macho'],
    ]);
  });

  it('everybody is macho when everything is settled', () => {
    const r = roastRanking(nets({ ana: 0, beto: 0, carla: 0 }), [], group);
    expect(r.every((e) => e.tier === 'macho')).toBe(true);
    expect(r.map((e) => e.uid)).toEqual(['ana', 'beto', 'carla']);
  });

  it('a single debtor is the top; one minor unit already counts as debt', () => {
    expect(tiers(roastRanking(nets({ ana: 1, beto: -1 }), [], group))).toEqual([
      ['beto', 'top'],
      ['ana', 'macho'],
    ]);
  });

  it('puts unknown uids last, ordered by uid', () => {
    const r = roastRanking(nets({ zz: 0, ana: 0, aa: 0 }), [], group);
    expect(r.map((e) => e.uid)).toEqual(['ana', 'aa', 'zz']);
  });

  it('rejects amounts that are not safe integers', () => {
    expect(() => roastRanking(nets({ ana: 1.5, beto: -1.5 }), [], group)).toThrow(EngineError);
  });
});

function ledgerFromPairwise(pairwise: Record<string, number>): LedgerEffect {
  const netByMember: Record<string, number> = {};
  for (const [key, amount] of Object.entries(pairwise)) {
    const [debtor, creditor] = key.split('>') as [string, string];
    netByMember[debtor] = (netByMember[debtor] ?? 0) - amount;
    netByMember[creditor] = (netByMember[creditor] ?? 0) + amount;
  }
  return { netByMember, pairwise };
}
const ranking = (ledger: LedgerEffect, group: Member[], view: 'original' | 'simplified') =>
  roastRanking(nets(ledger.netByMember), (view === 'original' ? originalDebts : simplifiedDebts)(ledger, group), group);
const owesOf = (r: ReturnType<typeof roastRanking>, uid: string) => r.find((e) => e.uid === uid)!;

describe('roastRanking relations (feature 007, US2)', () => {
  const abc = members('a', 'b', 'c');
  const chain = ledgerFromPairwise({ 'a>b': 30, 'b>c': 30 });

  it('direct view: A is the zorra of B and B of C', () => {
    const r = ranking(chain, abc, 'original');
    expect(owesOf(r, 'a').owes).toEqual([{ toUid: 'b', amountMinor: 30 }]);
    expect(owesOf(r, 'b').owes).toEqual([{ toUid: 'c', amountMinor: 30 }]);
    expect(owesOf(r, 'a').mainOwnerUid).toBe('b');
  });

  it('transitive view: A is the zorra of C and B of nobody', () => {
    const r = ranking(chain, abc, 'simplified');
    expect(owesOf(r, 'a').owes).toEqual([{ toUid: 'c', amountMinor: 30 }]);
    expect(owesOf(r, 'a').mainOwnerUid).toBe('c');
    expect(owesOf(r, 'b').owes).toEqual([]);
    expect(owesOf(r, 'b').mainOwnerUid).toBeNull();
  });

  it('lists every creditor, largest first; ties by join order', () => {
    const group = members('a', 'b', 'c', 'd');
    const ledger = ledgerFromPairwise({ 'a>d': 20, 'a>c': 20, 'a>b': 5 });
    const a = owesOf(ranking(ledger, group, 'original'), 'a');
    expect(a.owes).toEqual([
      { toUid: 'c', amountMinor: 20 },
      { toUid: 'd', amountMinor: 20 },
      { toUid: 'b', amountMinor: 5 },
    ]);
    expect(a.mainOwnerUid).toBe('c');
  });

  it('a macho can still owe someone in the direct view', () => {
    const ledger = ledgerFromPairwise({ 'a>b': 10, 'b>c': 5 });
    const b = owesOf(ranking(ledger, abc, 'original'), 'b');
    expect(b.tier).toBe('macho');
    expect(b.owes).toEqual([{ toUid: 'c', amountMinor: 5 }]);
  });

  it('labels are the same in both views', () => {
    const ledger = ledgerFromPairwise({ 'a>b': 30, 'b>c': 10, 'c>a': 5 });
    const tiersOf = (v: 'original' | 'simplified') => ranking(ledger, abc, v).map((e) => [e.uid, e.tier]);
    expect(tiersOf('original')).toEqual(tiersOf('simplified'));
  });
});
