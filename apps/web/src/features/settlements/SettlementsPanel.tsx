import { ArrowRightIcon, HandCoinsIcon, PaperclipIcon } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import type { SettlementStatus } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { inputClass } from '../../components/Field';
import { api } from '../../lib/apiClient';
import { formatMoney } from '../../lib/format';
import { AttachmentList } from '../attachments/AttachmentList';
import { useCurrentUser } from '../auth/AuthProvider';
import type { LiveMember, LiveTrip } from '../trips/useTrip';
import { useSettlements, type SettlementView } from './useSettlements';
import { RequiresOnline } from '../offline/RequiresOnline';
import { Avatar } from '../../components/ui/Avatar';
import { buttonClass } from '../../components/ui/Button';
import { cardClass } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

const STATUS_CLASS: Record<SettlementStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-rose-100 text-rose-900',
  cancelled: 'bg-slate-100 text-slate-700',
};

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

function Row({ s, trip, nameOf, uid, isManager, deleted }: { s: SettlementView; trip: LiveTrip; nameOf: (u: string) => string; uid: string; isManager: boolean; deleted: Set<string> }) {
  // Feature 006 (FR-009): managers act for a deleted receiver (confirm/reject) or emitter (cancel).
  const canResolve = s.toUid === uid || (isManager && deleted.has(s.toUid));
  const canCancel = s.fromUid === uid || (isManager && deleted.has(s.fromUid));
  const [showProof, setShowProof] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: ({ action, body }: { action: 'confirm' | 'reject' | 'cancel'; body?: Record<string, unknown> }) =>
      api('POST', `/trips/${trip.id}/settlements/${s.id}/${action}`, { body: { expectedVersion: s.version, ...body } }),
  });
  const mutable = trip.status === 'active';
  const pending = s.status === 'pending';
  return (
    <li className={`${cardClass} space-y-3 p-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <Avatar name={nameOf(s.fromUid)} seed={s.fromUid} size="sm" />
            <strong>{nameOf(s.fromUid)}</strong>
            <ArrowRightIcon aria-hidden={false} role="img" aria-label="paga a" className="text-slate-400" />
            <Avatar name={nameOf(s.toUid)} seed={s.toUid} size="sm" />
            <strong>{nameOf(s.toUid)}</strong>
            <span className="amount font-semibold">· {formatMoney(s.amountMinor, trip.currency)}</span>
          </span>
          {s.note && <span className="mt-1 block text-xs text-slate-600">{s.note}</span>}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
      </div>
      {s.status === 'rejected' && s.rejectionReason && <p className="text-sm text-slate-700">Motivo: {s.rejectionReason}</p>}
      {pending && mutable && canResolve && !rejecting && (
        <RequiresOnline label="Confirmar o rechazar">
        <div className="flex gap-2">
          <button type="button" disabled={act.isPending} onClick={() => act.mutate({ action: 'confirm' })} className={buttonClass('primary', 'sm')}>
            Confirmar
          </button>
          <button type="button" onClick={() => setRejecting(true)} className={buttonClass('secondary', 'sm')}>
            Rechazar
          </button>
        </div>
        </RequiresOnline>
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
              className={buttonClass('danger', 'sm')}
            >
              Confirmar rechazo
            </button>
            <button type="button" onClick={() => setRejecting(false)} className={buttonClass('secondary', 'sm')}>
              Volver
            </button>
          </div>
        </div>
      )}
      {pending && mutable && canCancel && (
        <button type="button" disabled={act.isPending} onClick={() => act.mutate({ action: 'cancel' })} className="text-sm text-red-700 underline">
          Cancelar pago
        </button>
      )}
      {(s.fromUid === uid || s.toUid === uid || isManager) && ((s.attachmentCount ?? 0) > 0 || (s.fromUid === uid && mutable && ['pending', 'confirmed'].includes(s.status))) && (
        <div>
          <button type="button" aria-expanded={showProof} onClick={() => setShowProof((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 hover:underline">
            <PaperclipIcon size={16} />
            {(s.attachmentCount ?? 0) > 0 ? `Comprobante de pago (${s.attachmentCount})` : 'Adjuntar comprobante'}
          </button>
          {showProof && (
            <AttachmentList
              tripId={trip.id}
              target={{ settlementId: s.id }}
              title="Comprobante de pago"
              canAdd={s.fromUid === uid && mutable && ['pending', 'confirmed'].includes(s.status)}
              canRemove={false}
            />
          )}
        </div>
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
  const deleted = new Set(members.filter((m) => m.deletedAt && m.uid).map((m) => m.uid!));
  const toConfirm = settlements.filter((s) => s.status === 'pending' && s.toUid === user.uid).length;
  const rows = tab === 'all' ? settlements : settlements.filter((s) => s.status === tab);

  return (
    <section aria-labelledby="payments-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payments-title" className="text-lg font-semibold tracking-tight">
          Pagos
        </h2>
        {trip.status === 'active' && (
          <RequiresOnline label="Registrar pago">
            <Link to={`/trips/${trip.id}/settlements/new`} className={buttonClass('secondary', 'sm')}>
              <HandCoinsIcon size={18} />
              Registrar pago
            </Link>
          </RequiresOnline>
        )}
      </div>
      {toConfirm > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
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
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 aria-selected:border-brand-700 aria-selected:bg-brand-700 aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<HandCoinsIcon size={28} weight="duotone" />} title="No hay pagos." />
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <Row key={s.id} s={s} trip={trip} nameOf={nameOf} uid={user.uid} isManager={['creator', 'admin'].includes(members.find((m) => m.uid === user.uid)?.role ?? '')} deleted={deleted} />
          ))}
        </ul>
      )}
    </section>
  );
}
