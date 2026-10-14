import { useMutation, useQuery } from '@tanstack/react-query';
import type { PreviewResponse } from 'contracts';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { ApiError, api } from '../../lib/apiClient';
import { formatDate, formatDateRange, formatMoney } from '../../lib/format';
import { useDoc } from '../../lib/useFirestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { AttachmentList } from '../attachments/AttachmentList';
import { useTrip } from '../trips/useTrip';
import { FIELD_LABEL } from './expenseEditModel';
import { ImpactPreview } from './ImpactPreview';
import { RefundForm } from './RefundForm';
import { useCollection } from '../../lib/useFirestore';
import { useCategories, type ExpenseView } from './useExpenses';
import { useOnline } from '../../lib/useOnline';

const ACTION_LABEL: Record<string, string> = {
  'expense.create': 'Creado',
  'expense.update': 'Editado',
  'expense.void': 'Anulado',
  'expense.restore': 'Restaurado',
  'refund.create': 'Devolución registrada',
  'attachment.add': 'Comprobante añadido',
  'attachment.remove': 'Comprobante quitado',
};
const KIND_LABEL = { discount: 'Descuento general', tax: 'Impuesto', tip: 'Propina' } as const;

interface HistoryResponse {
  events: { action: string; actorUid: string; timestamp: string; changed?: string[] }[];
}

/**
 * Expense detail (FR-028…FR-030). The document read is governed by Security Rules (RF-38):
 * denied or missing → "No encontrado", rendering nothing about the expense.
 */
export function ExpenseDetailPage() {
  const { tripId = '', expenseId = '' } = useParams();
  const { user } = useCurrentUser();
  const online = useOnline();
  const { trip, members, loading } = useTrip(tripId);
  const { all: categories } = useCategories(tripId);
  const expense = useDoc<Omit<ExpenseView, 'id'>>(`trips/${tripId}/expenses/${expenseId}`);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<{ action: 'void' | 'restore'; data: PreviewResponse } | null>(null);
  const visible = !!expense.data && !expense.error;

  const history = useQuery({
    queryKey: ['expense-history', tripId, expenseId, expense.data?.version],
    queryFn: () => api<HistoryResponse>('GET', `/trips/${tripId}/expenses/${expenseId}/history`),
    enabled: visible,
  });
  const voidMutation = useMutation({
    mutationFn: ({ version, ledgerRevision }: { version: number; ledgerRevision?: number }) =>
      api('POST', `/trips/${tripId}/expenses/${expenseId}/void`, {
        body: { expectedVersion: version, ...(ledgerRevision !== undefined ? { expectedLedgerRevision: ledgerRevision } : {}) },
      }),
    onSuccess: () => {
      setConfirming(false);
      setPreview(null);
    },
  });
  const [restoreDuplicate, setRestoreDuplicate] = useState(false);
  const [refundingItem, setRefundingItem] = useState<string | null>(null);
  const refunds = useCollection<{ itemId: string; quantity: number; amountMinor: number; recipientUid: string; createdBy: string }>(
    visible ? `trips/${tripId}/expenses/${expenseId}/refunds` : null,
  );
  const restoreMutation = useMutation({
    mutationFn: ({ version, ledgerRevision, confirmDuplicate }: { version: number; ledgerRevision?: number; confirmDuplicate?: boolean }) =>
      api('POST', `/trips/${tripId}/expenses/${expenseId}/restore`, {
        body: {
          expectedVersion: version,
          ...(ledgerRevision !== undefined ? { expectedLedgerRevision: ledgerRevision } : {}),
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
        },
      }),
    onSuccess: () => {
      setPreview(null);
      setRestoreDuplicate(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') setRestoreDuplicate(true);
    },
  });
  const previewMutation = useMutation({
    mutationFn: (action: 'void' | 'restore') =>
      api<PreviewResponse>('POST', `/trips/${tripId}/expenses/${expenseId}/preview`, { body: { action } }),
    onSuccess: (data, action) => setPreview({ action, data }),
  });

  if (loading || trip === undefined || expense.loading) return <Spinner />;
  // US3-5: a notification may point to an expense the user can no longer see.
  if (trip === null || !visible) return <NotFound message="Este elemento ya no está disponible o no tienes acceso." />;
  const e = expense.data!;
  const me = members.find((m) => m.uid === user.uid);
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? 'Participante';
  const money = (v: number) => formatMoney(v, trip.currency);
  const canRestore =
    e.status === 'voided' && trip.status === 'active' && (e.createdBy === user.uid || me?.role === 'creator' || me?.role === 'admin');
  const needsPreview = (trip.confirmedSettlementCount ?? 0) > 0;
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
          {e.source === 'ai' && <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-900">Escaneado</span>}
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

      {(e.splitMode === 'items' || e.status === 'active' || (refunds.data ?? []).length > 0) && (
        <section aria-label="Ítems" className="space-y-1">
          <h2 className="text-lg font-semibold">{e.splitMode === 'items' ? 'Ítems' : 'Importe y devoluciones'}</h2>
          <ul className="space-y-1 text-sm">
            {e.items.map((i) => {
              const name = i.description ?? (e.splitMode === 'total' ? e.description : 'Ítem');
              const itemRefunds = (refunds.data ?? []).filter((r) => r.itemId === i.id);
              const refunded = itemRefunds.reduce((a, r) => a + r.amountMinor, 0);
              return (
                <li key={i.id} className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span>
                      {name} {i.classification === 'personal' && <span className="text-slate-500">(personal)</span>}
                      <span className="block text-xs text-slate-600">
                        {(i as { quantity?: number }).quantity ?? 1} u. · {i.beneficiaries.map(nameOf).join(', ')}
                      </span>
                    </span>
                    <span className="text-right">
                      {money(i.grossMinor - i.discountMinor)}
                      {i.discountMinor > 0 && <span className="block text-xs text-slate-600">desc. {money(i.discountMinor)}</span>}
                      {refunded > 0 && <span className="block text-xs text-emerald-800">devuelto {money(refunded)}</span>}
                    </span>
                  </div>
                  {itemRefunds.length > 0 && (
                    <ul aria-label={`Devoluciones de ${name}`} className="space-y-0.5 pl-3 text-xs text-slate-700">
                      {itemRefunds.map((r) => (
                        <li key={r.id}>
                          {money(r.amountMinor)} ({r.quantity} u.) · recibió {nameOf(r.recipientUid)} · registró {nameOf(r.createdBy)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.status === 'active' && trip.status === 'active' && online && (
                    <button
                      type="button"
                      onClick={() => setRefundingItem((k) => (k === i.id ? null : i.id))}
                      className="text-xs text-brand-800 underline"
                      aria-label={`Registrar devolución de ${name}`}
                    >
                      Registrar devolución
                    </button>
                  )}
                  {refundingItem === i.id && (
                    <RefundForm
                      tripId={tripId}
                      expenseId={expenseId}
                      itemId={i.id}
                      itemName={name}
                      currency={trip.currency}
                      members={members.filter((m) => m.invitationStatus === 'accepted' && m.uid).map((m) => ({ uid: m.uid!, name: m.displayName ?? m.email }))}
                      onDone={() => setRefundingItem(null)}
                    />
                  )}
                </li>
              );
            })}
            {e.adjustments.map((a, k) => (
              <li key={k} className="flex justify-between gap-2 text-slate-700">
                <span>{KIND_LABEL[a.kind]}</span>
                <span>{a.kind === 'discount' ? '−' : ''}{money(a.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(canVoid || canRestore) && !online && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">Editar, anular, restaurar o registrar devoluciones necesita conexión.</p>
      )}
      {canVoid && online && (
        <Link to={`/trips/${tripId}/expenses/${expenseId}/edit`} className="inline-block rounded-lg border border-brand-700 px-4 py-2 font-medium text-brand-800">
          Editar gasto
        </Link>
      )}
      {canVoid && online && (
        <div className="space-y-2">
          {!confirming ? (
            <button
              type="button"
              onClick={() => ((trip.confirmedSettlementCount ?? 0) > 0 ? previewMutation.mutate('void') : setConfirming(true))}
              className="rounded-lg border border-red-300 px-4 py-2 text-red-800"
            >
              Anular gasto
            </button>
          ) : (
            <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm">El gasto dejará de contar en saldos y totales. Esta acción queda registrada en el historial.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={voidMutation.isPending}
                  onClick={() => voidMutation.mutate({ version: e.version })}
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
          {preview?.action === 'void' && (
            <ImpactPreview
              preview={preview.data}
              currency={trip.currency}
              nameOf={nameOf}
              busy={voidMutation.isPending}
              onConfirm={() => voidMutation.mutate({ version: e.version, ledgerRevision: preview.data.ledgerRevision })}
              onCancel={() => setPreview(null)}
            />
          )}
          <ErrorMessage error={voidMutation.error ?? previewMutation.error} />
        </div>
      )}

      {canRestore && online && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={restoreMutation.isPending || previewMutation.isPending}
            onClick={() => (needsPreview ? previewMutation.mutate('restore') : restoreMutation.mutate({ version: e.version }))}
            className="rounded-lg border border-brand-700 px-4 py-2 font-medium text-brand-800"
          >
            Restaurar gasto
          </button>
          {preview?.action === 'restore' && (
            <ImpactPreview
              preview={preview.data}
              currency={trip.currency}
              nameOf={nameOf}
              busy={restoreMutation.isPending}
              onConfirm={() => restoreMutation.mutate({ version: e.version, ledgerRevision: preview.data.ledgerRevision })}
              onCancel={() => setPreview(null)}
            />
          )}
          {restoreDuplicate && (
            <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">Posible duplicado</p>
              <p>Hay otro gasto vigente con la misma fecha, importe y pagador.</p>
              <button
                type="button"
                onClick={() => restoreMutation.mutate({ version: e.version, confirmDuplicate: true, ...(preview ? { ledgerRevision: preview.data.ledgerRevision } : {}) })}
                className="rounded-lg bg-amber-700 px-3 py-2 font-medium text-white"
              >
                Restaurar de todos modos
              </button>
            </div>
          )}
          {!restoreDuplicate && <ErrorMessage error={restoreMutation.error} />}
        </div>
      )}

      <AttachmentList
        tripId={tripId}
        target={{ expenseId }}
        canAdd={e.status === 'active' && trip.status === 'active'}
        canRemove={e.status === 'active' && trip.status === 'active' && (e.createdBy === user.uid || me?.role === 'creator' || me?.role === 'admin')}
      />

      <section aria-label="Historial" className="space-y-1">
        <h2 className="text-lg font-semibold">Historial</h2>
        {history.isLoading && <Spinner label="Cargando historial…" />}
        <ol className="space-y-1 text-sm">
          {history.data?.events.map((ev, k) => (
            <li key={k}>
              {ACTION_LABEL[ev.action] ?? ev.action}
              {ev.changed && ev.changed.length > 0 && ` (${ev.changed.map((f) => FIELD_LABEL[f] ?? f).join(', ')})`} por{' '}
              {nameOf(ev.actorUid)} ·{' '}
              {new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ev.timestamp))}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
