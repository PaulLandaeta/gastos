import { Link } from 'react-router';
import { useScanQuota } from '../scan/useScanQuota';
import type { LiveTrip } from './useTrip';

/** RF-25: prominent shortcuts on the trip home (manual registration and AI scan, FR-007). */
export function QuickActions({ trip }: { trip: LiveTrip }) {
  const quota = useScanQuota(trip.id, trip.status === 'active');
  if (trip.status === 'pending') {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Registro manual disponible cuando todos acepten la invitación.
      </p>
    );
  }
  if (trip.status !== 'active') return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Link
        to={`/trips/${trip.id}/expenses/new`}
        className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-brand-700 px-4 py-5 text-center font-semibold text-white shadow-sm"
      >
        <span aria-hidden className="text-2xl">✍️</span>
        Registro manual
      </Link>
      <Link
        to={`/trips/${trip.id}/scan`}
        aria-describedby="scan-quota-hint"
        className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-brand-700 px-4 py-5 text-center font-semibold text-brand-800"
      >
        <span aria-hidden className="text-2xl">📷</span>
        Escanear factura
        <span id="scan-quota-hint" className="text-xs font-normal text-slate-700">
          {quota.data
            ? quota.data.tripRemainingToday === 0
              ? 'Cuota agotada hoy'
              : `${quota.data.tripRemainingToday} disponibles hoy`
            : 'Con IA'}
        </span>
      </Link>
    </div>
  );
}
