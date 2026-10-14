import { originalDebts, simplifiedDebts, type Member } from 'finance-engine';
import type { Firestore } from '../firestore/client.js';
import { readLedger } from './ledgerRepo.js';
import { loadTripForMember } from './tripRepo.js';

/**
 * Balances from the incremental projection: O(1) reads regardless of the number of expenses.
 * Both views share `netByMember` (FR-011); the simplified one is only a proposal.
 */
export async function getBalances(db: Firestore, tripId: string, uid: string, view: 'original' | 'simplified') {
  return db.runTransaction(async (tx) => {
    const { trip, members } = await loadTripForMember(tx, tripId, uid);
    const ledger = await readLedger(tx, tripId);
    const accepted: Member[] = members
      .filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid)
      .map((m) => ({ uid: m.data.uid!, joinOrder: m.data.joinOrder ?? 0 }));
    const transfers =
      view === 'original' ? originalDebts(ledger.effect, accepted) : simplifiedDebts(ledger.effect, accepted);
    return {
      currency: trip.data.currency,
      view,
      netByMember: accepted.map((m) => ({ uid: m.uid, netMinor: ledger.effect.netByMember[m.uid] ?? 0 })),
      transfers,
      sourceRevision: trip.data.version,
    };
  });
}
