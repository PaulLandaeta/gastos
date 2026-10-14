import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { del, get, keys, set } from 'idb-keyval';

/**
 * Feature 005 (research R1): API answers marked `meta: { persist: true }` (balances, dashboard)
 * survive reloads offline. One key per account; 30 days; dropped on a new app version.
 */
const PREFIX = 'rq-cache:';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BUSTER = import.meta.env.VITE_APP_VERSION ?? '005';

/** Returns the stop function and a promise that resolves once the persisted cache is restored. */
export function startQueryPersistence(queryClient: QueryClient, uid: string): [() => void, Promise<void>] {
  const persister = createAsyncStoragePersister({
    storage: { getItem: (k) => get<string>(k), setItem: (k, v: string) => set(k, v), removeItem: (k) => del(k) },
    key: `${PREFIX}${uid}`,
    throttleTime: 500,
  });
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: MAX_AGE_MS,
    buster: BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: (q) => q.meta?.['persist'] === true && q.state.status === 'success' },
  });
  return [unsubscribe, restored.catch(() => undefined)];
}

export async function clearPersistedQueries(): Promise<void> {
  for (const k of await keys()) if (typeof k === 'string' && k.startsWith(PREFIX)) await del(k);
}

/** Forgets the cached answers of a trip (not opened in 30 days). */
export function removeTripQueries(queryClient: QueryClient, tripId: string): void {
  queryClient.removeQueries({ predicate: (q) => q.queryKey.includes(tripId) });
}
