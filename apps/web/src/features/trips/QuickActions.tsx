import { Link } from 'react-router';
import type { LiveTrip } from './useTrip';

/** RF-25: prominent shortcuts on the trip home. Scanning arrives in phase 4. */
export function QuickActions({ trip }: { trip: LiveTrip }) {
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
      <button
        type="button"
        disabled
        aria-describedby="scan-soon"
        className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-slate-300 px-4 py-5 text-center font-semibold text-slate-600"
      >
        <span aria-hidden className="text-2xl">📷</span>
        Escanear factura
        <span id="scan-soon" className="text-xs font-normal">
          Próximamente
        </span>
      </button>
    </div>
  );
}
