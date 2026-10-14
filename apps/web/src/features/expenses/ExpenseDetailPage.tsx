import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/apiClient';
import { formatDate, formatDateRange, formatMoney } from '../../lib/format';
import { useDoc } from '../../lib/useFirestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { useTrip } from '../trips/useTrip';
import { useCategories, type ExpenseView } from './useExpenses';

const ACTION_LABEL: Record<string, string> = { 'expense.create': 'Creado', 'expense.void': 'Anulado' };
const KIND_LABEL = { discount: 'Descuento general', tax: 'Impuesto', tip: 'Propina' } as const;

interface HistoryResponse {
  events: { action: string; actorUid: string; timestamp: string }[];
}

/**
 * Expense detail (FR-028…FR-030). The document read is governed by Security Rules (RF-38):
 * denied or missing → "No encontrado", rendering nothing about the expense.
 */
export function ExpenseDetailPage() {
  const { tripId = '', expenseId = '' } = useParams();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const { all: categories } = useCategories(tripId);
  const expense = useDoc<Omit<ExpenseView, 'id'>>(`trips/${tripId}/expenses/${expenseId}`);
  const [confirming, setConfirming] = useState(false);
  const visible = !!expense.data && !expense.error;

  const history = useQuery({
    queryKey: ['expense-history', tripId, expenseId, expense.data?.version],
    queryFn: () => api<HistoryResponse>('GET', `/trips/${tripId}/expenses/${expenseId}/history`),
    enabled: visible,
  });
  const voidMutation = useMutation({
    mutationFn: (version: number) =>
      api('POST', `/trips/${tripId}/expenses/${expenseId}/void`, { body: { expectedVersion: version } }),
    onSuccess: () => setConfirming(false),
  });

  if (loading || trip === undefined || expense.loading) return <Spinner />;
  if (trip === null || !visible) return <NotFound />;
  const e = expense.data!;
  const me = members.find((m) => m.uid === user.uid);
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? 'Participante';
  const money = (v: number) => formatMoney(v, trip.currency);
  const canVoid =
    e.status === 'active' &&
    (trip.status === 'active' || trip.status === 'pending') &&
    (e.createdBy === user.uid || me?.role === 'creator' || me?.role === 'admin');

  return (
    <article className="space-y-5">
      <Link to={`/trips/${tripId}/expenses`} className="text-sm text-brand-800 underline">
        Volver a gastos
      </Link>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{e.description}</h1>
          {e.status === 'voided' && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold">Anulado</span>}
        </div>
        <p className={`text-2xl font-bold ${e.status === 'voided' ? 'line-through text-slate-500' : ''}`}>{money(e.totalMinor)}</p>
        <p className="text-sm text-slate-600">
          {formatDate(e.transactionDate)} · {categories.find((c) => c.id === e.categoryId)?.name ?? '—'} · registrado por{' '}
          {nameOf(e.createdBy)}
        </p>
        {e.servicePeriod && (
          <p className="text-sm text-slate-600">Servicio: {formatDateRange(e.servicePeriod.startDate, e.servicePeriod.endDate)}</p>
        )}
        {e.notes && <p className="text-sm">{e.notes}</p>}
      </header>

      <section aria-label="Reparto por persona" className="space-y-2">
        <h2 className="text-lg font-semibold">Reparto por persona</h2>
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {Object.entries(e.chargesByMember).map(([uid, c]) => (
            <li key={uid} className="flex justify-between gap-2 p-3 text-sm">
              <span>{nameOf(uid)}</span>
              <span className="text-right">
                <strong>{money(c.netMinor)}</strong>
                <span className="block text-xs text-slate-600">
                  compartido {money(c.sharedMinor)}
                  {c.personalMinor > 0 && ` · personal ${money(c.personalMinor)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Pagadores" className="space-y-1">
        <h2 className="text-lg font-semibold">Pagadores</h2>
        <ul className="text-sm">
          {e.payers.map((p) => (
            <li key={p.uid}>
              {nameOf(p.uid)}: {money(p.amountMinor)}
            </li>
          ))}
        </ul>
      </section>

      {e.splitMode === 'items' && (
        <section aria-label="Ítems" className="space-y-1">
          <h2 className="text-lg font-semibold">Ítems</h2>
          <ul className="space-y-1 text-sm">
            {e.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>
                  {i.description ?? 'Ítem'} {i.classification === 'personal' && <span className="text-slate-500">(personal)</span>}
                  <span className="block text-xs text-slate-600">{i.beneficiaries.map(nameOf).join(', ')}</span>
                </span>
                <span>
                  {money(i.grossMinor - i.discountMinor)}
                  {i.discountMinor > 0 && <span className="block text-xs text-slate-600">desc. {money(i.discountMinor)}</span>}
                </span>
              </li>
            ))}
            {e.adjustments.map((a, k) => (
              <li key={k} className="flex justify-between gap-2 text-slate-700">
                <span>{KIND_LABEL[a.kind]}</span>
                <span>{a.kind === 'discount' ? '−' : ''}{money(a.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canVoid && (
        <div className="space-y-2">
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className="rounded-lg border border-red-300 px-4 py-2 text-red-800">
              Anular gasto
            </button>
          ) : (
            <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm">El gasto dejará de contar en saldos y totales. Esta acción queda registrada en el historial.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={voidMutation.isPending}
                  onClick={() => voidMutation.mutate(e.version)}
                  className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white"
                >
                  Confirmar anulación
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-slate-300 px-4 py-2">
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <ErrorMessage error={voidMutation.error} />
        </div>
      )}

      <section aria-label="Historial" className="space-y-1">
        <h2 className="text-lg font-semibold">Historial</h2>
        {history.isLoading && <Spinner label="Cargando historial…" />}
        <ol className="space-y-1 text-sm">
          {history.data?.events.map((ev, k) => (
            <li key={k}>
              {ACTION_LABEL[ev.action] ?? ev.action} por {nameOf(ev.actorUid)} ·{' '}
              {new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ev.timestamp))}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
