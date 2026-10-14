import { memberRanking, rankComparator } from './order.js';
import type { LedgerEffect, Member, Transfer, Uid } from './types.js';

function sortTransfers(transfers: Transfer[], cmp: (a: Uid, b: Uid) => number): Transfer[] {
  return transfers.sort((x, y) => cmp(x.fromUid, y.fromUid) || cmp(x.toUid, y.toUid));
}

/**
 * Original view (FR-011): pairwise debts derived from every expense and confirmed payment,
 * netted per pair (A→B 10 and B→A 4 become A→B 6).
 */
export function originalDebts(ledger: LedgerEffect, members: readonly Member[]): Transfer[] {
  const cmp = rankComparator(memberRanking(members));
  const pairs = new Map<string, { a: Uid; b: Uid; aOwesB: number }>();
  for (const [key, amount] of Object.entries(ledger.pairwise)) {
    const [debtor, creditor] = key.split('>') as [Uid, Uid];
    const [a, b] = cmp(debtor, creditor) <= 0 ? [debtor, creditor] : [creditor, debtor];
    const pairKey = `${a}>${b}`;
    const entry = pairs.get(pairKey) ?? { a, b, aOwesB: 0 };
    entry.aOwesB += debtor === a ? amount : -amount;
    pairs.set(pairKey, entry);
  }
  const transfers: Transfer[] = [];
  for (const { a, b, aOwesB } of pairs.values()) {
    if (aOwesB > 0) transfers.push({ fromUid: a, toUid: b, amountMinor: aOwesB });
    else if (aOwesB < 0) transfers.push({ fromUid: b, toUid: a, amountMinor: -aOwesB });
  }
  return sortTransfers(transfers, cmp);
}

/**
 * Simplified view (FR-011/FR-012): deterministic greedy proposal — the largest debtor pays the
 * largest creditor, ties by join order. It preserves every member's net balance; if it would
 * need more transfers than the original view, the original view is returned instead.
 * It is only a proposal: it never creates payments.
 */
export function simplifiedDebts(ledger: LedgerEffect, members: readonly Member[]): Transfer[] {
  const cmp = rankComparator(memberRanking(members));
  const debtors: { uid: Uid; amount: number }[] = [];
  const creditors: { uid: Uid; amount: number }[] = [];
  for (const [uid, net] of Object.entries(ledger.netByMember)) {
    if (net < 0) debtors.push({ uid, amount: -net });
    else if (net > 0) creditors.push({ uid, amount: net });
  }
  const pick = (xs: { uid: Uid; amount: number }[]) =>
    xs.reduce((best, x) =>
      x.amount > best.amount || (x.amount === best.amount && cmp(x.uid, best.uid) < 0) ? x : best,
    );

  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    const d = pick(debtors);
    const c = pick(creditors);
    const amount = Math.min(d.amount, c.amount);
    transfers.push({ fromUid: d.uid, toUid: c.uid, amountMinor: amount });
    d.amount -= amount;
    c.amount -= amount;
    if (d.amount === 0) debtors.splice(debtors.indexOf(d), 1);
    if (c.amount === 0) creditors.splice(creditors.indexOf(c), 1);
  }

  const original = originalDebts(ledger, members);
  return transfers.length <= original.length ? transfers : original;
}
