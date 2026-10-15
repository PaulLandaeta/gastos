import { assertSafeMinor } from './money.js';
import { compareUid, memberRanking } from './order.js';
import type { Member, Transfer, Uid } from './types.js';

/** Feature 007 (RF-57): tiers of the debt roast ranking; the labels live in the web app. */
export type RoastTier = 'top' | 'golfa' | 'senorita' | 'macho';

export interface RoastEntry {
  uid: Uid;
  netMinor: number;
  /** max(0, -netMinor). */
  debtMinor: number;
  tier: RoastTier;
  /** Who this member owes in the given view, largest amount first. */
  owes: { toUid: Uid; amountMinor: number }[];
  /** First creditor of `owes`, or null. */
  mainOwnerUid: Uid | null;
}

/** Canonical order (join order, then uid); uids missing from `members` go last, by uid. */
function orderOf(members: readonly Member[]): (a: Uid, b: Uid) => number {
  const rank = memberRanking(members);
  return (a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareUid(a, b);
  };
}

/**
 * Feature 007 (RF-57, research R5): presentation-only ranking from balances that every member can already see.
 * - top: the largest debt (one member; ties by the canonical order);
 * - golfa: any other debtor owing strictly more than half the top debt (integer comparison);
 * - senorita: the remaining debtors;
 * - macho: net balance ≥ 0.
 * `owes` comes from the transfers of the chosen view: original = direct debts, simplified = transitive (chains
 * A→B→C become A→C). Sorted by debt (descending), then the canonical order. Never changes balances.
 */
export function roastRanking(
  netByMember: readonly { uid: Uid; netMinor: number }[],
  transfers: readonly Transfer[],
  members: readonly Member[],
): RoastEntry[] {
  const cmp = orderOf(members);
  for (const b of netByMember) assertSafeMinor(b.netMinor, 'netMinor');

  const sorted = [...netByMember]
    .map((b) => ({ uid: b.uid, netMinor: b.netMinor, debtMinor: Math.max(0, -b.netMinor) }))
    .sort((a, b) => b.debtMinor - a.debtMinor || cmp(a.uid, b.uid));
  const maxDebt = sorted[0]?.debtMinor ?? 0;

  const owesBy = new Map<Uid, { toUid: Uid; amountMinor: number }[]>();
  for (const t of transfers) {
    assertSafeMinor(t.amountMinor, 'amountMinor');
    const list = owesBy.get(t.fromUid) ?? [];
    list.push({ toUid: t.toUid, amountMinor: t.amountMinor });
    owesBy.set(t.fromUid, list);
  }
  for (const list of owesBy.values()) list.sort((a, b) => b.amountMinor - a.amountMinor || cmp(a.toUid, b.toUid));

  return sorted.map((e, i): RoastEntry => {
    const tier: RoastTier =
      e.debtMinor === 0 ? 'macho' : i === 0 ? 'top' : 2 * e.debtMinor > maxDebt ? 'golfa' : 'senorita';
    const owes = owesBy.get(e.uid) ?? [];
    return { ...e, tier, owes, mainOwnerUid: owes[0]?.toUid ?? null };
  });
}
