import { ReceiptIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { Role, StatsResponse } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { Button } from '../../components/ui/Button';
import { cardClass } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Segmented } from '../../components/ui/Segmented';
import { api } from '../../lib/apiClient';
import { CategoryIcon } from '../../lib/categoryIcon';
import { formatDate, formatMoney } from '../../lib/format';
import { TripPendingList } from '../offline/PendingList';
import { usePending } from '../offline/usePending';
import type { LiveMember, LiveTrip } from '../trips/useTrip';
import { useCategories, useExpenses, type Category, type ExpenseView } from './useExpenses';

type Filter = 'shared' | 'personal';

function ExpenseRow({
  e,
  tripId,
  currency,
  category,
  nameOf,
}: {
  e: ExpenseView;
  tripId: string;
  currency: string;
  category: Category | undefined;
  nameOf: (uid: string) => string;
}) {
  const voided = e.status === 'voided';
  return (
    <li>
      <Link
        to={`/trips/${tripId}/expenses/${e.id}`}
        className={`flex items-center gap-3 px-3 py-3 transition-colors hover:bg-slate-50 ${voided ? 'text-slate-500' : ''}`}
      >
        <span className={voided ? 'opacity-50 grayscale' : ''}>
          <CategoryIcon category={category} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{e.description}</span>
            {voided && <span className="shrink-0 rounded-md bg-slate-200 px-1.5 text-xs font-medium text-slate-700">Anulado</span>}
          </span>
          <span className="block truncate text-sm text-slate-600">
            pagó {e.payerUids.map(nameOf).join(', ')} · {category?.name ?? '—'}
          </span>
        </span>
        <span className={`amount shrink-0 font-semibold ${voided ? 'line-through' : 'text-slate-900'}`}>{formatMoney(e.totalMinor, currency)}</span>
      </Link>
    </li>
  );
}

function localToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  if (iso === localToday()) return 'Hoy';
  if (iso === localToday(-1)) return 'Ayer';
  return formatDate(iso);
}

/** Consecutive rows of the same date (the query is ordered by date, newest first). */
function byDay(rows: ExpenseView[]): { date: string; rows: ExpenseView[] }[] {
  const groups: { date: string; rows: ExpenseView[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.transactionDate) last.rows.push(r);
    else groups.push({ date: r.transactionDate, rows: [r] });
  }
  return groups;
}

/** FR-027: visible expenses only (RF-38); shared and personal filters (FR-024), grouped by day. */
export function ExpenseList({ trip, members, myRole, uid }: { trip: LiveTrip; members: LiveMember[]; myRole: Role; uid: string }) {
  const { all: categories } = useCategories(trip.id);
  const isManager = myRole === 'creator' || myRole === 'admin';
  const [filter, setFilter] = useState<Filter>('shared');
  const list = useExpenses({ tripId: trip.id, uid, isManager });
  const { pending } = usePending(trip.id);
  const stats = useQuery({
    queryKey: ['stats', trip.id, trip.version, myRole],
    queryFn: () => api<StatsResponse>('GET', `/trips/${trip.id}/stats`),
    enabled: filter === 'personal',
  });

  const nameOf = (u: string) => members.find((m) => m.uid === u)?.displayName ?? 'Participante';
  const categoryOf = (id: string) => categories.find((c) => c.id === id);
  const rows = list.data.filter((e) => (filter === 'shared' ? e.sharedTotalMinor > 0 : e.personalBeneficiaryUids?.includes(uid)));

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Gastos</h2>
      <Segmented
        label="Tipo de gasto"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'shared', label: 'Compartidos' },
          { value: 'personal', label: 'Personales' },
        ]}
      />
      <div role="tabpanel" aria-label={filter === 'shared' ? 'Compartidos' : 'Personales'} className="space-y-4">
        {filter === 'personal' && stats.data && (
          <p className="rounded-xl bg-surface px-3 py-2.5 text-sm shadow-card">
            Tus gastos personales: <strong className="amount">{formatMoney(stats.data.me.personalConsumedMinor, trip.currency)}</strong> · no
            suman al total compartido; sí a tu total global ({formatMoney(stats.data.me.globalConsumedMinor, trip.currency)}).
          </p>
        )}
        {filter === 'shared' && <TripPendingList pending={pending} currency={trip.currency} />}
        <ErrorMessage error={list.error} />
        {list.loading && list.data.length === 0 && <Spinner />}
        {!list.loading && rows.length === 0 && (
          <EmptyState icon={<ReceiptIcon size={28} weight="duotone" />} title="No hay gastos que mostrar.">
            {trip.status === 'active' && filter === 'shared' ? 'Toca el botón + para registrar el primero.' : null}
          </EmptyState>
        )}
        {byDay(rows).map((g) => {
          const dayTotal = g.rows.filter((e) => e.status !== 'voided').reduce((s, e) => s + e.totalMinor, 0);
          return (
            <section key={g.date} aria-label={dayLabel(g.date)} className="space-y-1.5">
              <div className="flex items-baseline justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span>{dayLabel(g.date)}</span>
                <span className="amount normal-case">{formatMoney(dayTotal, trip.currency)}</span>
              </div>
              <ul className={`${cardClass} divide-y divide-slate-100 overflow-hidden`}>
                {g.rows.map((e) => (
                  <ExpenseRow key={e.id} e={e} tripId={trip.id} currency={trip.currency} category={categoryOf(e.categoryId)} nameOf={nameOf} />
                ))}
              </ul>
            </section>
          );
        })}
        {list.hasMore && (
          <Button variant="secondary" onClick={list.loadMore} className="w-full">
            Cargar más
          </Button>
        )}
      </div>
    </div>
  );
}
