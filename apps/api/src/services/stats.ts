import type { Firestore } from '../firestore/client.js';
import { readLedger } from './ledgerRepo.js';
import { emptyStats, type MemberStats } from './projections.js';
import { loadTripForMember } from './tripRepo.js';

/**
 * Dashboard figures from the incremental projections (≤ 6 reads, any number of expenses).
 * Applies spec Q3 (category chart scope) and FR-026 (other people's totals only for managers).
 */
export async function getStats(db: Firestore, tripId: string, uid: string) {
  return db.runTransaction(async (tx) => {
    const { trip, members, me } = await loadTripForMember(tx, tripId, uid);
    const isManager = me.data.role === 'creator' || me.data.role === 'admin';
    const accepted = members.filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid).map((m) => m.data.uid!);
    const paths = [
      `trips/${tripId}/projections/public`,
      `trips/${tripId}/projections/categories`,
      ...(isManager ? accepted : [uid]).map((u) => `trips/${tripId}/memberStats/${u}`),
    ];
    const [docs, ledger] = await Promise.all([tx.getAll(paths), readLedger(tx, tripId)]);
    const statsOf = (u: string): MemberStats => ({
      ...emptyStats(),
      ...((docs.get(`trips/${tripId}/memberStats/${u}`)?.data ?? {}) as Partial<MemberStats>),
    });
    const pick = (s: MemberStats) => ({
      contributedMinor: s.contributedMinor,
      sharedConsumedMinor: s.sharedConsumedMinor,
      personalConsumedMinor: s.personalConsumedMinor,
      globalConsumedMinor: s.globalConsumedMinor,
    });
    const pub = docs.get(`trips/${tripId}/projections/public`)?.data ?? {};
    const mine = statsOf(uid);
    return {
      currency: trip.data.currency,
      sharedTotalMinor: (pub['sharedTotalMinor'] as number | undefined) ?? 0,
      expenseCount: (pub['expenseCount'] as number | undefined) ?? 0,
      me: { ...pick(mine), balanceMinor: ledger.effect.netByMember[uid] ?? 0 },
      byCategory: isManager
        ? (((docs.get(`trips/${tripId}/projections/categories`)?.data ?? {})['byCategory'] ?? {}) as Record<string, number>)
        : mine.visibleSharedByCategory,
      ...(isManager ? { members: accepted.map((u) => ({ uid: u, ...pick(statsOf(u)) })) } : {}),
    };
  });
}
