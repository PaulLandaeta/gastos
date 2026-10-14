import { useState } from 'react';
import { Link } from 'react-router';
import { Spinner } from '../../components/Spinner';
import { useDoc } from '../../lib/useFirestore';
import { useOnline } from '../../lib/useOnline';
import { useCurrentUser } from '../auth/AuthProvider';
import type { PendingExpense } from './outbox';
import { PendingRow } from './PendingList';
import { outboxFor, syncNow } from './runtime';
import { usePending } from './usePending';

function PendingCard({ p }: { p: PendingExpense }) {
  const { user } = useCurrentUser();
  const trip = useDoc<{ name: string; currency: string }>(`trips/${p.tripId}`);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outbox = outboxFor(user.uid);
  const sending = p.status === 'sending';
  const run = (fn: () => Promise<unknown>) => fn().catch((e: Error) => setError(e.message));

  return (
    <div className="space-y-2">
      {trip.data && <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{trip.data.name}</p>}
      <ul>
        <PendingRow p={p} currency={trip.data?.currency} />
      </ul>
      <div className="flex flex-wrap gap-2 text-sm">
        {p.recoverable && (
          <Link
            to={`/pending/${p.localId}/edit`}
            aria-disabled={sending}
            className={`rounded-lg border border-slate-300 px-3 py-1.5 ${sending ? 'pointer-events-none opacity-50' : ''}`}
          >
            Editar <span className="sr-only">{p.input.description}</span>
          </Link>
        )}
        {p.error?.code === 'POSSIBLE_DUPLICATE' && p.status === 'needs_attention' && (
          <button
            type="button"
            onClick={() => void run(async () => (await outbox.confirmDuplicate(p.localId), syncNow()))}
            className="rounded-lg bg-amber-700 px-3 py-1.5 font-medium text-white"
          >
            Enviar igualmente
          </button>
        )}
        {!confirming ? (
          <button
            type="button"
            disabled={sending}
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-red-800 disabled:opacity-50"
          >
            Descartar <span className="sr-only">{p.input.description}</span>
          </button>
        ) : (
          <span role="group" aria-label="Confirmar descarte" className="flex flex-wrap items-center gap-2">
            <span>¿Descartar «{p.input.description}»? No se podrá recuperar.</span>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-slate-300 px-3 py-1.5">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void run(() => outbox.discard(p.localId))}
              className="rounded-lg bg-red-700 px-3 py-1.5 font-medium text-white"
            >
              Sí, descartar
            </button>
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

/** `/pending`: every pending expense of the account (FR-004, FR-005, FR-003a). */
export function PendingPage() {
  const { pending, loading } = usePending();
  const online = useOnline();
  const [syncing, setSyncing] = useState(false);
  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Gastos pendientes</h1>
        <button
          type="button"
          disabled={!online || syncing || pending.every((p) => p.status === 'needs_attention')}
          onClick={() => {
            setSyncing(true);
            void syncNow().finally(() => setSyncing(false));
          }}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncing ? 'Enviando…' : 'Reintentar ahora'}
        </button>
      </div>
      {!online && <p className="text-sm text-slate-700">Se enviarán automáticamente cuando vuelva la conexión.</p>}
      {pending.length === 0 ? (
        <p className="text-slate-600">No tienes gastos pendientes de enviar.</p>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <PendingCard key={p.localId} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
