import { useMutation } from '@tanstack/react-query';
import type { SettlementStatus } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { inputClass } from '../../components/Field';
import { api } from '../../lib/apiClient';
import { formatMoney } from '../../lib/format';
import { useCurrentUser } from '../auth/AuthProvider';
import type { LiveMember, LiveTrip } from '../trips/useTrip';
import { useSettlements, type SettlementView } from './useSettlements';

const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
};

const TABS: { key: 'all' | SettlementStatus; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'rejected', label: 'Rechazados' },
];

function Row({ s, trip, nameOf, uid }: { s: SettlementView; trip: LiveTrip; nameOf: (u: string) => string; uid: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: ({ action, body }: { action: 'confirm' | 'reject' | 'cancel'; body?: Record<string, unknown> }) =>
      api('POST', `/trips/${trip.id}/settlements/${s.id}/${action}`, { body: { expectedVersion: s.version, ...body } }),
  });
  const mutable = trip.status === 'active';
  const pending = s.status === 'pending';
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>{nameOf(s.fromUid)}</strong> → <strong>{nameOf(s.toUid)}</strong> · {formatMoney(s.amountMinor, trip.currency)}
          {s.note && <span className="block text-xs text-slate-600">{s.note}</span>}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{STATUS_LABEL[s.status]}</span>
      </div>
      {s.status === 'rejected' && s.rejectionReason && <p className="text-sm text-slate-700">Motivo: {s.rejectionReason}</p>}
      {pending && mutable && s.toUid === uid && !rejecting && (
        <div className="flex gap-2">
          <button type="button" disabled={act.isPending} onClick={() => act.mutate({ action: 'confirm' })} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">
            Confirmar
          </button>
          <button type="button" onClick={() => setRejecting(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Rechazar
          </button>
        </div>
      )}
      {rejecting && (
        <div className="space-y-2">
          <label htmlFor={`reason-${s.id}`} className="block text-sm">
            Motivo (opcional)
          </label>
          <input id={`reason-${s.id}`} maxLength={200} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: 'reject', body: reason.trim() ? { reason } : {} })}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white"
            >
              Confirmar rechazo
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
              Volver
            </button>
          </div>
        </div>
      )}
      {pending && mutable && s.fromUid === uid && (
        <button type="button" disabled={act.isPending} onClick={() => act.mutate({ action: 'cancel' })} className="text-sm text-red-700 underline">
          Cancelar pago
        </button>
      )}
      <ErrorMessage error={act.error} />
    </li>
  );
}

/** RF-09/RF-21 and FR-006: payments with receiver confirmation, filterable by state. */
export function SettlementsPanel({ trip, members }: { trip: LiveTrip; members: LiveMember[] }) {
  const { user } = useCurrentUser();
  const { settlements } = useSettlements(trip.id);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? 'Participante';
  const toConfirm = settlements.filter((s) => s.status === 'pending' && s.toUid === user.uid).length;
  const rows = tab === 'all' ? settlements : settlements.filter((s) => s.status === tab);

  return (
    <section aria-labelledby="payments-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payments-title" className="text-lg font-semibold">
          Pagos
        </h2>
        {trip.status === 'active' && (
          <Link to={`/trips/${trip.id}/settlements/new`} className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-800">
            Registrar pago
          </Link>
        )}
      </div>
      {toConfirm > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          {toConfirm === 1 ? '1 pago por confirmar' : `${toConfirm} pagos por confirmar`}
        </p>
      )}
      <div role="tablist" aria-label="Estado del pago" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-sm aria-selected:border-brand-700 aria-selected:bg-brand-700 aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No hay pagos.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <Row key={s.id} s={s} trip={trip} nameOf={nameOf} uid={user.uid} />
          ))}
        </ul>
      )}
    </section>
  );
}
