import { FireIcon } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage';
import { api } from '../../lib/apiClient';
import { RequiresOnline } from '../offline/RequiresOnline';
import type { LiveTrip } from '../trips/useTrip';

/** Feature 007 (RF-57): creator/admin switch; off by default. The live trip listener shows the change. */
export function SpicyModeToggle({ trip }: { trip: LiveTrip }) {
  const on = trip.spicyMode === true;
  const save = useMutation({
    mutationFn: () => api('PATCH', `/trips/${trip.id}`, { body: { expectedVersion: trip.version, spicyMode: !on } }),
  });

  return (
    <div className="space-y-1">
      <RequiresOnline label="Modo picante">
        <button
          type="button"
          aria-pressed={on}
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium aria-pressed:border-orange-300 aria-pressed:bg-orange-50 aria-pressed:text-orange-900 disabled:opacity-60"
        >
          <FireIcon weight={on ? 'fill' : 'regular'} className={on ? 'text-orange-500' : 'text-slate-500'} />
          Modo picante: {on ? 'activado' : 'desactivado'}
        </button>
      </RequiresOnline>
      <p className="text-xs text-slate-600">Muestra a todo el grupo un ranking de deudores en tono de broma.</p>
      <ErrorMessage error={save.error} />
    </div>
  );
}
