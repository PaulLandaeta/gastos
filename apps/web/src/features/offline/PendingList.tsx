import { HourglassIcon, WarningIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { errorText } from '../../components/ErrorMessage';
import { ApiError } from '../../lib/apiClient';
import { formatDate, formatMoney } from '../../lib/format';
import type { PendingExpense } from './outbox';

const STATUS_LABEL: Record<PendingExpense['status'], string> = {
  pending: 'Pendiente',
  sending: 'Enviando',
  needs_attention: 'Requiere atención',
};

export function pendingReason(p: PendingExpense): string | null {
  if (!p.error) return null;
  return errorText(new ApiError(p.error.code as never, 0, p.error.message, p.error.details));
}

/** A pending expense: labelled, and never counted in balances until synced. */
export function PendingRow({ p, currency }: { p: PendingExpense; currency: string | undefined }) {
  const attention = p.status === 'needs_attention';
  return (
    <li
      className={`rounded-xl border border-dashed p-3 ${attention ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {p.input.description}
            <span className={`ml-2 rounded px-1.5 text-xs ${attention ? 'bg-red-200 text-red-900' : 'bg-amber-200 text-amber-950'}`}>
              {attention ? <WarningIcon weight="fill" size={12} className="mr-0.5 inline align-[-1px]" /> : <HourglassIcon size={12} className="mr-0.5 inline align-[-1px]" />}
              {STATUS_LABEL[p.status]}
            </span>
          </span>
          <span className="block text-sm text-slate-700">
            {formatDate(p.input.transactionDate)} · aún no cuenta en los saldos
          </span>
        </span>
        <span className="shrink-0 font-semibold">{currency ? formatMoney(p.input.totalMinor, currency) : p.input.totalMinor}</span>
      </div>
      {attention && <p className="mt-1 text-sm text-red-900">Motivo: {pendingReason(p)}</p>}
    </li>
  );
}

/** Pending expenses of one trip, shown above the synced ones (US1 scenario 2). */
export function TripPendingList({ pending, currency }: { pending: PendingExpense[]; currency: string }) {
  if (pending.length === 0) return null;
  return (
    <section aria-label="Gastos pendientes de enviar" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Pendientes de enviar</h2>
        <Link to="/pending" className="text-sm text-brand-800 underline">
          Gestionar
        </Link>
      </div>
      <ul className="space-y-2">
        {pending.map((p) => (
          <PendingRow key={p.localId} p={p} currency={currency} />
        ))}
      </ul>
    </section>
  );
}
