import { DateInput } from '../../components/ui/DatePicker';
import { Select } from '../../components/ui/Select';
import type { Category } from '../expenses/useExpenses';
import type { DashboardFilters } from './dashboardModel';

/** One row of filters above the figures (FR-025). */
export function Filters({
  value,
  onChange,
  categories,
  people,
}: {
  value: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  categories: Category[];
  people: { uid: string; name: string }[];
}) {
  const set = (patch: Partial<DashboardFilters>) => onChange({ ...value, ...patch });
  const opt = (v: string) => (v === '' ? undefined : v);
  const peopleOptions = people.map((p) => ({ value: p.uid, label: p.name }));
  return (
    <div role="group" aria-label="Filtros" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div className="text-xs text-slate-700">
        <label htmlFor="f-from">Desde</label>
        <DateInput id="f-from" title="Desde" placeholder="Cualquiera" allowClear value={value.from ?? ''} onChange={(v) => set({ from: opt(v) })} />
      </div>
      <div className="text-xs text-slate-700">
        <label htmlFor="f-to">Hasta</label>
        <DateInput id="f-to" title="Hasta" placeholder="Cualquiera" allowClear value={value.to ?? ''} onChange={(v) => set({ to: opt(v) })} />
      </div>
      <div className="text-xs text-slate-700">
        <label htmlFor="f-category">Categoría</label>
        <Select
          id="f-category"
          title="Categoría"
          value={value.categoryId ?? ''}
          onChange={(v) => set({ categoryId: opt(v) })}
          options={[{ value: '', label: 'Todas' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>
      <div className="text-xs text-slate-700">
        <label htmlFor="f-person">Persona</label>
        <Select
          id="f-person"
          title="Persona"
          value={value.personUid ?? ''}
          onChange={(v) => set({ personUid: opt(v) })}
          options={[{ value: '', label: 'Todas' }, ...peopleOptions]}
        />
      </div>
      <div className="text-xs text-slate-700">
        <label htmlFor="f-payer">Pagador</label>
        <Select
          id="f-payer"
          title="Pagador"
          value={value.payerUid ?? ''}
          onChange={(v) => set({ payerUid: opt(v) })}
          options={[{ value: '', label: 'Todos' }, ...peopleOptions]}
        />
      </div>
    </div>
  );
}
