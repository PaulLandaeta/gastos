import { DateInput } from '../../components/ui/DatePicker';
import { inputClass } from '../../components/Field';
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
        <select id="f-category" className={inputClass} value={value.categoryId ?? ''} onChange={(e) => set({ categoryId: opt(e.target.value) })}>
          <option value="">Todas</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="text-xs text-slate-700">
        <label htmlFor="f-person">Persona</label>
        <select id="f-person" className={inputClass} value={value.personUid ?? ''} onChange={(e) => set({ personUid: opt(e.target.value) })}>
          <option value="">Todas</option>
          {people.map((p) => (
            <option key={p.uid} value={p.uid}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="text-xs text-slate-700">
        <label htmlFor="f-payer">Pagador</label>
        <select id="f-payer" className={inputClass} value={value.payerUid ?? ''} onChange={(e) => set({ payerUid: opt(e.target.value) })}>
          <option value="">Todos</option>
          {people.map((p) => (
            <option key={p.uid} value={p.uid}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
