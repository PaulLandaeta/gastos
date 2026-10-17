import { PlusIcon, ScanIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useScanQuota } from '../scan/useScanQuota';
import type { LiveTrip } from './useTrip';
import { RequiresOnline } from '../offline/RequiresOnline';

/**
 * RF-25: floating shortcuts to register an expense, always in reach on an active trip — the main
 * «+» (manual registration) and the AI scan above it (FR-007).
 */
export function AddExpenseFab({ trip }: { trip: LiveTrip }) {
  const quota = useScanQuota(trip.id, trip.status === 'active');
  if (trip.status !== 'active') return null;
  const remaining = quota.data?.tripRemainingToday;
  const hint = quota.data ? (remaining === 0 ? 'Cuota agotada hoy' : `${remaining} disponibles hoy`) : 'Con IA';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20">
      <div className="mx-auto flex max-w-3xl flex-col items-end gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <RequiresOnline
          label="Escanear factura"
          className="pointer-events-auto cursor-not-allowed rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 shadow-card"
        >
          <Link
            to={`/trips/${trip.id}/scan`}
            aria-label="Escanear factura"
            aria-describedby="scan-quota-hint"
            title={`Escanear factura · ${hint}`}
            className="pointer-events-auto relative mr-1 flex h-12 w-12 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 shadow-card hover:border-brand-600"
          >
            <ScanIcon size={24} weight="bold" />
            {remaining !== undefined && (
              <span aria-hidden className="absolute -right-1 -top-1 min-w-5 rounded-full bg-brand-700 px-1 text-center text-[11px] font-semibold leading-5 text-white">
                {remaining}
              </span>
            )}
            <span id="scan-quota-hint" className="sr-only">
              {hint}
            </span>
          </Link>
        </RequiresOnline>
        <Link
          to={`/trips/${trip.id}/expenses/new`}
          aria-label="Registro manual"
          title="Registro manual"
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-fab transition-transform hover:scale-105 hover:bg-brand-800"
        >
          <PlusIcon size={28} weight="bold" />
        </Link>
      </div>
    </div>
  );
}
