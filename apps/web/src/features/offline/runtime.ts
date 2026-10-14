import type { QueryClient } from '@tanstack/react-query';
import type { CreateExpenseBody } from 'contracts';
import { api } from '../../lib/apiClient';
import type { LocalStores } from '../../lib/cacheOwner';
import { clearFirestoreCache } from '../../lib/firebase';
import { clearPersistedQueries, removeTripQueries, startQueryPersistence } from '../../lib/queryPersist';
import { isOnline, onReconnect } from '../../lib/useOnline';
import { deleteLocalDb } from './localDb';
import { Outbox, type PendingExpense } from './outbox';
import { syncOutbox } from './sync';
import { TripAccess } from './tripAccess';

/** Stores wiped on sign-out or when another account takes the device (FR-008). */
export const localStores: LocalStores = {
  clearFirestore: clearFirestoreCache,
  clearQueryCache: clearPersistedQueries,
  clearOutbox: deleteLocalDb,
};

const RETRY_TICK_MS = 10_000;

interface Session {
  uid: string;
  outbox: Outbox;
  tripAccess: TripAccess;
  run: (force?: boolean) => Promise<void>;
  stop: () => void;
}

let session: Session | null = null;

function send(p: PendingExpense) {
  const body: CreateExpenseBody = { ...p.input, ...(p.confirmDuplicate ? { confirmDuplicate: true } : {}) };
  return api('POST', `/trips/${p.tripId}/expenses`, { body, idempotencyKey: p.idempotencyKey });
}

/**
 * Starts the offline machinery for a signed-in account: persisted queries, the 30-day purge, and
 * the sync triggers (start, reconnect, back to foreground, periodic retry, manual). Resolves when
 * the persisted queries are back (bounded, so a slow disk never blocks the app).
 */
export function startOfflineSession(uid: string, queryClient: QueryClient): Promise<void> {
  if (session?.uid === uid) return Promise.resolve();
  session?.stop();
  const outbox = new Outbox(uid);
  const tripAccess = new TripAccess(uid);
  const [stopPersist, restored] = startQueryPersistence(queryClient, uid);

  const run = async (force = false) => {
    if (!isOnline()) return;
    const r = await syncOutbox({ outbox, send, force }).catch(() => null);
    if (r?.sent) await queryClient.invalidateQueries();
  };
  // FR-009: on reconnect, server answers (with the current permissions) replace the cache.
  const stopReconnect = onReconnect(() => {
    void queryClient.invalidateQueries();
    void run();
  });
  const onVisible = () => document.visibilityState === 'visible' && void run();
  document.addEventListener('visibilitychange', onVisible);
  const tick = setInterval(() => void run(), RETRY_TICK_MS);

  void outbox.resetOrphans().then(() => run());
  void tripAccess.purge(Date.now(), (tripId) => removeTripQueries(queryClient, tripId));

  session = {
    uid,
    outbox,
    tripAccess,
    run,
    stop: () => {
      stopPersist();
      stopReconnect();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(tick);
    },
  };
  return Promise.race([restored, new Promise<void>((r) => setTimeout(r, 2_000))]);
}

export function stopOfflineSession(): void {
  session?.stop();
  session = null;
}

export function outboxFor(uid: string): Outbox {
  return session?.uid === uid ? session.outbox : new Outbox(uid);
}

export function tripAccessFor(uid: string): TripAccess {
  return session?.uid === uid ? session.tripAccess : new TripAccess(uid);
}

/** «Reintentar ahora»: ignores the backoff. */
export function syncNow(): Promise<void> {
  return session ? session.run(true) : Promise.resolve();
}
