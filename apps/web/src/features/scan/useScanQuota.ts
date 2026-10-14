import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';

export interface ScanQuota {
  tripRemainingToday: number;
  tripLimit: number;
  exhaustedScope: string | null;
  resetsAt: string | null;
}

/** Remaining AI scans for the trip today (FR-016/T031). */
export function useScanQuota(tripId: string, enabled = true) {
  return useQuery({
    queryKey: ['scan-quota', tripId],
    queryFn: () => api<ScanQuota>('GET', `/trips/${tripId}/scans/quota`),
    enabled,
    staleTime: 30_000,
  });
}
