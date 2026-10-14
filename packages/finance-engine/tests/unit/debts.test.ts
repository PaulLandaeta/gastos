import { describe, expect, it } from 'vitest';
import { originalDebts, simplifiedDebts, type LedgerEffect, type Member } from '../../src/index.js';

const m = (...uids: string[]): Member[] => uids.map((uid, joinOrder) => ({ uid, joinOrder }));

function ledgerFromPairwise(pairwise: Record<string, number>): LedgerEffect {
  const netByMember: Record<string, number> = {};
  for (const [key, amount] of Object.entries(pairwise)) {
    const [debtor, creditor] = key.split('>') as [string, string];
    netByMember[debtor] = (netByMember[debtor] ?? 0) - amount;
    netByMember[creditor] = (netByMember[creditor] ?? 0) + amount;
  }
  for (const k of Object.keys(netByMember)) if (netByMember[k] === 0) delete netByMember[k];
  return { netByMember, pairwise };
}

describe('originalDebts', () => {
  it('compensa deudas en ambos sentidos de cada par (A→B 10, B→A 4 ⇒ A→B 6)', () => {
    const ledger = ledgerFromPairwise({ 'a>b': 10, 'b>a': 4 });
    expect(originalDebts(ledger, m('a', 'b'))).toEqual([{ fromUid: 'a', toUid: 'b', amountMinor: 6 }]);
  });

  it('omite pares compensados por completo', () => {
    const ledger = ledgerFromPairwise({ 'a>b': 5, 'b>a': 5 });
    expect(originalDebts(ledger, m('a', 'b'))).toEqual([]);
  });
});

describe('simplifiedDebts', () => {
  it('resuelve deudas circulares conservando el neto (escenario 6)', () => {
    const members = m('a', 'b', 'c');
    const ledger = ledgerFromPairwise({ 'a>b': 10, 'b>c': 5, 'c>a': 5 });
    expect(originalDebts(ledger, members)).toHaveLength(3);
    expect(simplifiedDebts(ledger, members)).toEqual([{ fromUid: 'a', toUid: 'b', amountMinor: 5 }]);
  });

  it('un ciclo perfecto no requiere transferencias', () => {
    const ledger = ledgerFromPairwise({ 'a>b': 10, 'b>c': 10, 'c>a': 10 });
    expect(simplifiedDebts(ledger, m('a', 'b', 'c'))).toEqual([]);
  });

  it('resuelve empates por orden de entrada', () => {
    const members = m('a', 'b', 'c', 'd');
    const ledger = ledgerFromPairwise({ 'a>d': 5, 'b>c': 5 });
    expect(simplifiedDebts(ledger, members)).toEqual([
      { fromUid: 'a', toUid: 'c', amountMinor: 5 },
      { fromUid: 'b', toUid: 'd', amountMinor: 5 },
    ]);
  });

  it('es determinista ante el orden de la lista de miembros', () => {
    const ledger = ledgerFromPairwise({ 'a>b': 7, 'c>b': 3, 'c>d': 2 });
    const members = m('a', 'b', 'c', 'd');
    expect(simplifiedDebts(ledger, [...members].reverse())).toEqual(simplifiedDebts(ledger, members));
  });
});
