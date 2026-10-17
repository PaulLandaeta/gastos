import { buttonClass } from '../../components/ui/Button';
import { useMutation } from '@tanstack/react-query';
import type { Role, TripStatusAction } from 'contracts';
import { ErrorMessage } from '../../components/ErrorMessage';
import { api } from '../../lib/apiClient';
import type { LiveTrip } from './useTrip';
import { RequiresOnline } from '../offline/RequiresOnline';

const LABEL: Record<TripStatusAction, string> = {
  close: 'Cerrar viaje',
  reopen: 'Reabrir viaje',
  archive: 'Archivar viaje',
  restore: 'Restaurar viaje',
};

function allowedActions(trip: LiveTrip, role: Role): TripStatusAction[] {
  const manager = role === 'creator' || role === 'admin';
  const actions: TripStatusAction[] = [];
  if (manager && trip.status === 'active') actions.push('close');
  if (manager && trip.status === 'closed') actions.push('reopen');
  if (role === 'creator' && trip.status !== 'archived') actions.push('archive');
  if (role === 'creator' && trip.status === 'archived') actions.push('restore');
  return actions;
}

export function ReadOnlyBanner({ trip }: { trip: LiveTrip }) {
  if (trip.status === 'closed') {
    return (
      <p role="status" className="rounded-xl bg-slate-200/70 px-3 py-2.5 text-sm text-slate-800">
        Este viaje está cerrado: solo lectura. El creador o un admin puede reabrirlo.
      </p>
    );
  }
  if (trip.status === 'archived') {
    return (
      <p role="status" className="rounded-xl bg-slate-200/70 px-3 py-2.5 text-sm text-slate-800">
        Este viaje está archivado: solo lectura y oculto de tus viajes activos.
      </p>
    );
  }
  return null;
}

export function TripStatusActions({ trip, role }: { trip: LiveTrip; role: Role }) {
  const change = useMutation({
    mutationFn: (action: TripStatusAction) =>
      api('POST', `/trips/${trip.id}/status`, { body: { expectedVersion: trip.version, action } }),
  });
  const actions = allowedActions(trip, role);
  if (actions.length === 0) return null;
  return (
    <RequiresOnline label="Cambiar estado del viaje">
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={change.isPending}
            onClick={() => change.mutate(a)}
            className={buttonClass('secondary', 'sm', a === 'archive' ? 'text-slate-700' : 'border-brand-600 text-brand-800')}
          >
            {LABEL[a]}
          </button>
        ))}
      </div>
      <ErrorMessage error={change.error} />
    </div>
    </RequiresOnline>
  );
}
