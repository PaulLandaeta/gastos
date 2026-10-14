import type { Member, Trip } from 'contracts';
import { useDoc, useCollection } from '../../lib/useFirestore';

export type LiveTrip = Omit<Trip, 'id'> & { id: string };
export type LiveMember = Omit<Member, 'key'> & { id: string };

export function sortMembers(members: LiveMember[]): LiveMember[] {
  const rank = (m: LiveMember) => (m.invitationStatus === 'accepted' ? (m.joinOrder ?? 0) : 1000);
  return [...members].sort((a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email));
}

/** Live trip + members; `trip === null` when it does not exist or the user has no access. */
export function useTrip(tripId: string) {
  const trip = useDoc<Omit<Trip, 'id'>>(`trips/${tripId}`);
  const members = useCollection<Omit<Member, 'key'>>(`trips/${tripId}/members`);
  const forbidden = trip.error !== null || members.error !== null;
  return {
    loading: !forbidden && (trip.loading || members.loading),
    trip: forbidden ? null : (trip.data ?? (trip.loading ? undefined : null)),
    members: sortMembers(members.data ?? []),
  };
}
