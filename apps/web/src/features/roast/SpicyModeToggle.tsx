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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm aria-pressed:border-brand-700 aria-pressed:bg-brand-700 aria-pressed:text-white disabled:opacity-60"
        >
          Modo picante: {on ? 'activado' : 'desactivado'}
        </button>
      </RequiresOnline>
      <p className="text-xs text-slate-600">Muestra a todo el grupo un ranking de deudores en tono de broma.</p>
      <ErrorMessage error={save.error} />
    </div>
  );
}
