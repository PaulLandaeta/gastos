import { Card, cardClass } from '../../components/ui/Card';
import { useQuery } from '@tanstack/react-query';
import type { StatsResponse } from 'contracts';
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/apiClient';
import { formatMoney } from '../../lib/format';
import { useCurrentUser } from '../auth/AuthProvider';
import { useCategories, useExpenses } from '../expenses/useExpenses';
import type { LiveMember, LiveTrip } from '../trips/useTrip';
import { CategoryChart } from './CategoryChart';
import { aggregate, applyFilters, hasFilters, type DashboardFilters } from './dashboardModel';
import { Filters } from './Filters';

function Tile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={emphasis ? 'col-span-2 rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-100 sm:col-span-1' : `${cardClass} p-3`}
    >
      <p className={`text-xs ${emphasis ? 'font-medium text-brand-800' : 'text-slate-600'}`}>{label}</p>
      <p className={`amount ${emphasis ? 'text-2xl font-bold text-brand-900' : 'text-lg font-semibold'}`}>{value}</p>
    </div>
  );
}

/** FR-023…FR-026: dashboard from projections; client-side aggregation when filters are active. */
export function DashboardPanel({ trip, members }: { trip: LiveTrip; members: LiveMember[] }) {
  const { user } = useCurrentUser();
  const me = members.find((m) => m.uid === user.uid);
  const isManager = me?.role === 'creator' || me?.role === 'admin';
  const [filters, setFilters] = useState<DashboardFilters>({});
  const filtering = hasFilters(filters);
  const { all: categories } = useCategories(trip.id);
  const stats = useQuery({
    queryKey: ['stats', trip.id, trip.version, me?.role],
    queryFn: () => api<StatsResponse>('GET', `/trips/${trip.id}/stats`),
    // Feature 005: kept for offline reading (≤ 30 days, per account).
    meta: { persist: true },
  });
  const filtered = useExpenses({
    tripId: trip.id,
    uid: user.uid,
    isManager: filtering ? isManager : false,
    pageSize: filtering ? 1000 : 1,
    ...(filtering && filters.from ? { from: filters.from } : {}),
    ...(filtering && filters.to ? { to: filters.to } : {}),
    ...(filtering && filters.categoryId ? { categoryId: filters.categoryId } : {}),
  });

  const money = (v: number) => formatMoney(v, trip.currency);
  const people = members.filter((m) => m.invitationStatus === 'accepted' && m.uid).map((m) => ({ uid: m.uid!, name: m.displayName ?? m.email }));
  const categoryData = (by: Record<string, number>) =>
    Object.entries(by).map(([id, amountMinor]) => {
      const c = categories.find((x) => x.id === id);
      return { id, name: c?.name ?? 'Otra', color: c?.color ?? '#64748b', amountMinor };
    });

  let figures: { shared: number; contributed: number; sharedConsumed: number; personal: number; global: number; byCategory: Record<string, number> } | null = null;
  if (filtering) {
    const a = aggregate(applyFilters(filtered.data, filters), user.uid);
    figures = { shared: a.sharedTotalMinor, contributed: a.contributedMinor, sharedConsumed: a.sharedConsumedMinor, personal: a.personalConsumedMinor, global: a.globalConsumedMinor, byCategory: a.byCategory };
  } else if (stats.data) {
    const s = stats.data;
    figures = { shared: s.sharedTotalMinor, contributed: s.me.contributedMinor, sharedConsumed: s.me.sharedConsumedMinor, personal: s.me.personalConsumedMinor, global: s.me.globalConsumedMinor, byCategory: s.byCategory };
  }

  return (
    <section aria-labelledby="dashboard-title" className="space-y-3">
      <h2 id="dashboard-title" className="text-lg font-semibold tracking-tight">
        Resumen del viaje
      </h2>
      <Filters value={filters} onChange={setFilters} categories={categories} people={people} />
      {filtering && (
        <p className="text-xs text-slate-600">
          Vista filtrada: solo gastos que puedes ver.{' '}
          <button type="button" className="underline" onClick={() => setFilters({})}>
            Quitar filtros
          </button>
        </p>
      )}
      <ErrorMessage error={stats.error ?? filtered.error} />
      {!figures ? (
        <Spinner label="Calculando resumen…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label={filtering ? 'Total compartido (filtrado)' : 'Total compartido del viaje'} value={money(figures.shared)} emphasis />
            <Tile label="Tu aporte" value={money(figures.contributed)} />
            <Tile label="Tu consumo compartido" value={money(figures.sharedConsumed)} />
            <Tile label="Tus gastos personales" value={money(figures.personal)} />
            <Tile label="Tu total global" value={money(figures.global)} />
            {!filtering && stats.data && (
              <Tile
                label="Tu saldo"
                value={`${stats.data.me.balanceMinor > 0 ? 'te deben ' : stats.data.me.balanceMinor < 0 ? 'debes ' : ''}${money(Math.abs(stats.data.me.balanceMinor))}`}
              />
            )}
          </div>
          <Card className="p-4">
          <CategoryChart
            caption="Gasto compartido por categoría"
            currency={trip.currency}
            data={categoryData(figures.byCategory)}
          />
          </Card>
          {!filtering && isManager && stats.data?.members && (
            <details className={`${cardClass} p-3 text-sm`}>
              <summary className="cursor-pointer font-medium">Totales por participante (solo administradores)</summary>
              <table className="mt-2 w-full text-left">
                <thead>
                  <tr className="text-slate-600">
                    <th scope="col">Persona</th>
                    <th scope="col">Aporte</th>
                    <th scope="col">Consumo compartido</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.data.members.map((m) => (
                    <tr key={m.uid}>
                      <th scope="row" className="font-normal">
                        {people.find((p) => p.uid === m.uid)?.name ?? '—'}
                      </th>
                      <td className="tabular-nums">{money(m.contributedMinor)}</td>
                      <td className="tabular-nums">{money(m.sharedConsumedMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  );
}
