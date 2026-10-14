import { EngineError } from './money.js';
import type { Member, Uid } from './types.js';

/**
 * Stable ranking of members: `joinOrder` ascending (creator first, then acceptance order),
 * ties broken by uid. Used as the canonical order for every tie-break in the engine.
 */
export function memberRanking(members: readonly Member[]): Map<Uid, number> {
  const seen = new Set<Uid>();
  for (const m of members) {
    if (seen.has(m.uid)) throw new EngineError('INVALID_ALLOCATION', 'Duplicate member', { uid: m.uid });
    seen.add(m.uid);
  }
  const sorted = [...members].sort((a, b) => a.joinOrder - b.joinOrder || compareUid(a.uid, b.uid));
  return new Map(sorted.map((m, i) => [m.uid, i]));
}

export function compareUid(a: Uid, b: Uid): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Comparator by member rank; uids unknown to the trip (e.g. anonymized) go last, by uid. */
export function rankComparator(rank: Map<Uid, number>): (a: Uid, b: Uid) => number {
  return (a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareUid(a, b);
  };
}
