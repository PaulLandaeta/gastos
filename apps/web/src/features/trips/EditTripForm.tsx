import { DateRangeInputs } from '../../components/ui/DatePicker';
import { buttonClass } from '../../components/ui/Button';
import { useMutation } from '@tanstack/react-query';
import type { Role } from 'contracts';
import { useState, type FormEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, inputClass } from '../../components/Field';
import { api } from '../../lib/apiClient';
import type { LiveTrip } from './useTrip';

export function EditTripForm({ trip, myRole, onDone }: { trip: LiveTrip; myRole: Role; onDone: () => void }) {
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const save = useMutation({
    mutationFn: () =>
      api('PATCH', `/trips/${trip.id}`, { body: { expectedVersion: trip.version, name, startDate, endDate } }),
    onSuccess: onDone,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-slate-200/70 bg-surface shadow-card p-4">
      <Field id="edit-name" label="Nombre del viaje">
        <input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <DateRangeInputs
        start={{ id: 'edit-start', label: 'Fecha de inicio' }}
        end={{ id: 'edit-end', label: 'Fecha de fin' }}
        value={{ start: startDate, end: endDate }}
        onChange={(v) => {
          setStartDate(v.start);
          setEndDate(v.end);
        }}
      />
      {myRole !== 'creator' && <p className="text-xs text-slate-600">Solo el creador puede cambiar la moneda.</p>}
      <ErrorMessage error={save.error} />
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={buttonClass('primary', 'md')}>
          Guardar
        </button>
        <button type="button" onClick={onDone} className={buttonClass('secondary', 'md')}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
