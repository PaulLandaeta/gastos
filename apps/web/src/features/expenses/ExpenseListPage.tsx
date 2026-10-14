import { useQuery } from '@tanstack/react-query';
import type { StatsResponse } from 'contracts';
import { useState } from 'react';
import { api } from '../../lib/apiClient';
import { Link, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { formatDate, formatMoney } from '../../lib/format';
import { useCurrentUser } from '../auth/AuthProvider';
import { TripPendingList } from '../offline/PendingList';
import { usePending } from '../offline/usePending';
import { useTrip } from '../trips/useTrip';
import { useCategories, useExpenses, type ExpenseView } from './useExpenses';

type Tab = 'shared' | 'personal';

export function ExpenseRow({
  e,
  tripId,
  currency,
  categoryName,
  nameOf,
}: {
  e: ExpenseView;
  tripId: string;
  currency: string;
  categoryName: string;
  nameOf: (uid: string) => string;
}) {
  return (
    <li>
      <Link
        to={`/trips/${tripId}/expenses/${e.id}`}
        className={`flex items-center justify-between gap-3 rounded-xl border p-3 hover:border-brand-600 ${
          e.status === 'voided' ? 'border-dashed border-slate-300 text-slate-500' : 'border-slate-200'
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {e.description}
            {e.status === 'voided' && <span className="ml-2 rounded bg-slate-200 px-1.5 text-xs text-slate-700">Anulado</span>}
          </span>
          <span className="block text-sm text-slate-600">
            {formatDate(e.transactionDate)} · {categoryName} · pagó {e.payerUids.map(nameOf).join(', ')}
          </span>
        </span>
        <span className={`shrink-0 font-semibold ${e.status === 'voided' ? 'line-through' : ''}`}>
          {formatMoney(e.totalMinor, currency)}
        </span>
      </Link>
    </li>
  );
}

/** FR-027: visible expenses only (RF-38); shared and personal tabs (FR-024). */
export function ExpenseListPage() {
  const { tripId = '' } = useParams();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const { all: categories } = useCategories(tripId);
  const me = members.find((m) => m.uid === user.uid);
  const isManager = me?.role === 'creator' || me?.role === 'admin';
  const [tab, setTab] = useState<Tab>('shared');
  const list = useExpenses({ tripId, uid: user.uid, isManager });
  const { pending } = usePending(tripId);
  const stats = useQuery({
    queryKey: ['stats', tripId, trip?.version, me?.role],
    queryFn: () => api<StatsResponse>('GET', `/trips/${tripId}/stats`),
    enabled: tab === 'personal' && !!trip,
  });

  if (loading || trip === undefined) return <Spinner />;
  if (trip === null || !me) return <NotFound />;
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? 'Participante';
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';
  const rows = list.data.filter((e) =>
    tab === 'shared' ? e.sharedTotalMinor > 0 : e.personalBeneficiaryUids?.includes(user.uid),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Gastos</h1>
        <Link to={`/trips/${tripId}`} className="text-sm text-brand-800 underline">
          Volver al viaje
        </Link>
      </div>
      <div role="tablist" aria-label="Tipo de gasto" className="inline-flex rounded-lg border border-slate-300 p-0.5">
        {(['shared', 'personal'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="rounded-md px-3 py-1.5 text-sm aria-selected:bg-brand-700 aria-selected:text-white"
          >
            {t === 'shared' ? 'Compartidos' : 'Personales'}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab === 'shared' ? 'Compartidos' : 'Personales'} className="space-y-2">
        {tab === 'personal' && stats.data && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            Tus gastos personales: <strong>{formatMoney(stats.data.me.personalConsumedMinor, trip.currency)}</strong> · no
            suman al total compartido; sí a tu total global ({formatMoney(stats.data.me.globalConsumedMinor, trip.currency)}).
          </p>
        )}
        {tab === 'shared' && <TripPendingList pending={pending} currency={trip.currency} />}
        <ErrorMessage error={list.error} />
        {list.loading && list.data.length === 0 && <Spinner />}
        {!list.loading && rows.length === 0 && <p className="text-slate-600">No hay gastos que mostrar.</p>}
        <ul className="space-y-2">
          {rows.map((e) => (
            <ExpenseRow key={e.id} e={e} tripId={tripId} currency={trip.currency} categoryName={categoryName(e.categoryId)} nameOf={nameOf} />
          ))}
        </ul>
        {list.hasMore && (
          <button type="button" onClick={list.loadMore} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cargar más
          </button>
        )}
      </div>
    </div>
  );
}
