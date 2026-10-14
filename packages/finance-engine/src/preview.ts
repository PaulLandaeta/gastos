import { combineEffects } from './ledger.js';
import { memberRanking } from './order.js';
import type { LedgerEffect, Member, Uid } from './types.js';

export interface BalanceRow {
  uid: Uid;
  netMinor: number;
}

/** RF-28: balances before/after applying `changes` to the ledger, for every member in join order. */
export function balancesPreview(ledger: LedgerEffect, changes: LedgerEffect[], members: Member[]) {
  const ordered = [...memberRanking(members).keys()];
  const after = combineEffects(ledger, ...changes);
  const row = (e: LedgerEffect) => ordered.map((uid) => ({ uid, netMinor: e.netByMember[uid] ?? 0 }));
  const before = row(ledger);
  const next = row(after);
  return { before, after: next, delta: next.map((r, i) => ({ uid: r.uid, netMinor: r.netMinor - before[i]!.netMinor })) };
}
