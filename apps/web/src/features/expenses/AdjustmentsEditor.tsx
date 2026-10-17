import { buttonClass } from '../../components/ui/Button';
import { MoneyInput } from '../../components/MoneyInput';
import { newKey, type DraftAdjustment, type ExpenseDraft } from './expenseFormModel';
import type { MemberOption } from './MemberChips';

const KIND: Record<DraftAdjustment['kind'], { add: string; amount: string; mode: string; title: string }> = {
  discount: { add: 'Añadir descuento', amount: 'Importe del descuento', mode: 'Reparto del descuento', title: 'Descuento general' },
  tax: { add: 'Añadir impuesto', amount: 'Importe del impuesto', mode: 'Reparto del impuesto', title: 'Impuesto' },
  tip: { add: 'Añadir propina', amount: 'Importe de la propina', mode: 'Reparto de la propina', title: 'Propina' },
};

const MODE: Record<DraftAdjustment['mode'], string> = {
  proportional: 'Proporcional al consumo',
  equal: 'Partes iguales',
  manual: 'Manual',
};

/** RF-11/RF-45: general discount, taxes and tips, each proportional, equal or manual. */
export function AdjustmentsEditor({
  draft,
  setDraft,
  currency,
  members,
}: {
  draft: ExpenseDraft;
  setDraft: (u: (d: ExpenseDraft) => ExpenseDraft) => void;
  currency: string;
  members: MemberOption[];
}) {
  const update = (key: string, patch: Partial<DraftAdjustment>) =>
    setDraft((d) => ({ ...d, adjustments: d.adjustments.map((a) => (a.key === key ? { ...a, ...patch } : a)) }));
  const add = (kind: DraftAdjustment['kind']) =>
    setDraft((d) => ({
      ...d,
      adjustments: [
        ...d.adjustments,
        { key: newKey('a'), kind, amountMinor: null, mode: kind === 'tip' ? 'equal' : 'proportional', manual: {} },
      ],
    }));

  return (
    <section aria-label="Ajustes generales" className="space-y-3">
      <h3 className="text-sm font-semibold">Ajustes generales</h3>
      {draft.adjustments.map((a) => (
        <div key={a.key} className="space-y-2 rounded-2xl border border-slate-200/70 bg-surface shadow-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{KIND[a.kind].title}</span>
            <button
              type="button"
              className="text-sm text-red-700 underline"
              onClick={() => setDraft((d) => ({ ...d, adjustments: d.adjustments.filter((x) => x.key !== a.key) }))}
            >
              Quitar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MoneyInput
              label={KIND[a.kind].amount}
              currency={currency}
              valueMinor={a.amountMinor}
              onChange={(v) => update(a.key, { amountMinor: v })}
            />
            <label className="space-y-1 text-sm">
              <span className="block font-medium text-slate-800">{KIND[a.kind].mode}</span>
              <select
                className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={a.mode}
                onChange={(e) => update(a.key, { mode: e.target.value as DraftAdjustment['mode'] })}
              >
                {(Object.keys(MODE) as DraftAdjustment['mode'][]).map((m) => (
                  <option key={m} value={m}>
                    {MODE[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {a.mode === 'manual' && (
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.uid} className="grid grid-cols-[1fr_9rem] items-center gap-2 text-sm">
                  <span>{m.name}</span>
                  <MoneyInput
                    label={`${KIND[a.kind].title} de ${m.name}`}
                    compact
                    currency={currency}
                    valueMinor={a.manual[m.uid] ?? null}
                    onChange={(v) => update(a.key, { manual: { ...a.manual, [m.uid]: v } })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND) as DraftAdjustment['kind'][]).map((k) => (
          <button key={k} type="button" onClick={() => add(k)} className={buttonClass('secondary', 'sm')}>
            {KIND[k].add}
          </button>
        ))}
      </div>
    </section>
  );
}
