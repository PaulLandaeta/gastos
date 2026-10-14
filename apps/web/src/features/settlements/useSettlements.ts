import type { SettlementDto } from 'contracts';
import { useMemo } from 'react';
import { useCollection } from '../../lib/useFirestore';

export type SettlementView = SettlementDto & { createdAt?: Date };

/** Live payments of the trip (readable by every member: public debt graph, RF-39). */
export function useSettlements(tripId: string) {
  const { data, loading, error } = useCollection<Omit<SettlementView, 'id'>>(`trips/${tripId}/settlements`);
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
    [data],
  );
  return { settlements: sorted as SettlementView[], loading, error };
}
