import { useEffect, useState } from 'react';
import { useCurrentUser } from '../auth/AuthProvider';
import { subscribeOutbox, type PendingExpense } from './outbox';
import { outboxFor } from './runtime';

/** Live list of the account's pending expenses (this tab and the others), optionally per trip. */
export function usePending(tripId?: string): { pending: PendingExpense[]; loading: boolean } {
  const { user } = useCurrentUser();
  const [state, setState] = useState<{ pending: PendingExpense[]; loading: boolean }>({ pending: [], loading: true });

  useEffect(() => {
    let alive = true;
    const load = () =>
      void outboxFor(user.uid)
        .list(tripId)
        .then((pending) => alive && setState({ pending, loading: false }))
        .catch(() => alive && setState({ pending: [], loading: false }));
    load();
    const unsubscribe = subscribeOutbox(user.uid, load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [user.uid, tripId]);

  return state;
}

export const pendingCounts = (pending: PendingExpense[]) => ({
  waiting: pending.filter((p) => p.status !== 'needs_attention').length,
  attention: pending.filter((p) => p.status === 'needs_attention').length,
});
