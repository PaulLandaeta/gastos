import { buttonClass } from '../../components/ui/Button';
import { parseMoneyInput } from 'contracts';
import { useState } from 'react';
import { inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { assignInBulk, newItem, type AllocationMode, type DraftItem, type ExpenseDraft, type Issue } from './expenseFormModel';
import { MemberChips, type MemberOption } from './MemberChips';

const MODE_LABEL: Record<AllocationMode, string> = { equal: 'Partes iguales', fixed: 'Importe fijo', percent: 'Porcentaje' };

function bpToText(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '';
  const s = String(bp).padStart(3, '0');
  return `${s.slice(0, -2)},${s.slice(-2)}`;
}

function ItemRow({
  item,
  index,
  currency,
  members,
  issues,
  review,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  currency: string;
  members: MemberOption[];
  issues: Issue[];
  review: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onChange: (item: DraftItem) => void;
  onRemove: () => void;
}) {
  const withoutBeneficiary = item.beneficiaries.length === 0;
  const itemIssues = issues.filter((i) => i.itemKey === item.key);
  return (
    <div
      role="group"
      aria-label={`Ítem ${index + 1}`}
      className={`space-y-2 rounded-xl border p-3 ${withoutBeneficiary || review ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="Seleccionar ítem" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
          <span className="font-medium">{item.description || `Ítem ${index + 1}`}</span>
        </label>
        {review && (
          <span id={`${item.key}-review`} className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold text-amber-950">
            Revisar
          </span>
        )}
        <button type="button" onClick={onRemove} className="text-sm text-red-700 underline" aria-label={`Quitar ítem ${index + 1}`}>
          Quitar
        </button>
      </div>
      <div className="grid grid-cols-[1fr_9rem] gap-2">
        <div>
          <label htmlFor={`${item.key}-name`} className="sr-only">
            Nombre del ítem
          </label>
          <input
            id={`${item.key}-name`}
            aria-describedby={review ? `${item.key}-review` : undefined}
            placeholder="Producto"
            className={inputClass}
            value={item.description}
            onChange={(e) => onChange({ ...item, description: e.target.value })}
          />
        </div>
        <MoneyInput
          id={`${item.key}-gross`}
          label="Importe del ítem"
          compact
          currency={currency}
          valueMinor={item.grossMinor}
          onChange={(v) => onChange({ ...item, grossMinor: v })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        Cantidad
        <input
          type="number"
          min={1}
          inputMode="numeric"
          className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1"
          value={item.quantity}
          onChange={(e) => onChange({ ...item, quantity: Math.max(1, Number.parseInt(e.target.value || '1', 10) || 1) })}
        />
      </label>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-700">Descuento del ítem</summary>
        <div className="mt-2 max-w-48">
          <MoneyInput
            id={`${item.key}-discount`}
            label="Descuento del ítem"
            currency={currency}
            valueMinor={item.discountMinor}
            onChange={(v) => onChange({ ...item, discountMinor: v })}
          />
        </div>
      </details>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={item.classification === 'personal'}
          onChange={(e) =>
            onChange({
              ...item,
              classification: e.target.checked ? 'personal' : 'shared',
              beneficiaries: e.target.checked ? item.beneficiaries.slice(0, 1) : item.beneficiaries,
              mode: e.target.checked ? 'equal' : item.mode,
            })
          }
        />
        Personal
      </label>
      <MemberChips
        label={item.classification === 'personal' ? '¿De quién es?' : '¿Quiénes lo consumieron?'}
        options={members}
        single={item.classification === 'personal'}
        selected={item.beneficiaries}
        onChange={(uids) => onChange({ ...item, beneficiaries: uids })}
      />
      {withoutBeneficiary && <p className="text-xs font-medium text-amber-900">Sin beneficiario: asígnalo para poder guardar.</p>}
      {item.classification === 'shared' && item.beneficiaries.length > 1 && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            Modo de reparto
            <select
              className={buttonClass('secondary', 'sm')}
              value={item.mode}
              onChange={(e) => onChange({ ...item, mode: e.target.value as AllocationMode })}
            >
              {(Object.keys(MODE_LABEL) as AllocationMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          {item.mode !== 'equal' && (
            <ul className="space-y-1">
              {item.beneficiaries.map((uid) => {
                const name = members.find((m) => m.uid === uid)?.name ?? uid;
                return (
                  <li key={uid} className="grid grid-cols-[1fr_9rem] items-center gap-2 text-sm">
                    <span>{name}</span>
                    {item.mode === 'fixed' ? (
                      <MoneyInput
                        label={`Importe de ${name}`}
                        compact
                        currency={currency}
                        valueMinor={item.fixed[uid] ?? null}
                        onChange={(v) => onChange({ ...item, fixed: { ...item.fixed, [uid]: v } })}
                      />
                    ) : (
                      <span className="flex items-center gap-1">
                        <label htmlFor={`${item.key}-${uid}-pct`} className="sr-only">
                          Porcentaje de {name}
                        </label>
                        <input
                          id={`${item.key}-${uid}-pct`}
                          inputMode="decimal"
                          className={inputClass}
                          defaultValue={bpToText(item.percentBp[uid])}
                          onChange={(e) =>
                            onChange({ ...item, percentBp: { ...item.percentBp, [uid]: parseMoneyInput(e.target.value, 2) } })
                          }
                        />
                        %
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {itemIssues
        .filter((i) => i.code !== 'NO_BENEFICIARY')
        .map((i) => (
          <p key={i.code} className="text-xs text-red-700">
            {i.message}
          </p>
        ))}
    </div>
  );
}

/** RF-05/RF-12/RF-27/RF-42: invoice line items with bulk assignment and per-item modes. */
export function ItemsEditor({
  draft,
  setDraft,
  currency,
  members,
  issues,
  reviewItemKeys = [],
}: {
  draft: ExpenseDraft;
  setDraft: (u: (d: ExpenseDraft) => ExpenseDraft) => void;
  currency: string;
  members: MemberOption[];
  issues: Issue[];
  /** Rows flagged by the AI scan (low confidence). */
  reviewItemKeys?: string[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkUids, setBulkUids] = useState<string[]>(members.map((m) => m.uid));
  const allUids = members.map((m) => m.uid);

  return (
    <section aria-label="Ítems" className="space-y-3">
      {draft.items.map((item, index) => (
        <ItemRow
          key={item.key}
          item={item}
          index={index}
          currency={currency}
          members={members}
          issues={issues}
          review={reviewItemKeys.includes(item.key)}
          selected={selected.includes(item.key)}
          onSelect={(on) => setSelected((s) => (on ? [...s, item.key] : s.filter((k) => k !== item.key)))}
          onChange={(next) => setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === item.key ? next : i)) }))}
          onRemove={() => {
            setSelected((s) => s.filter((k) => k !== item.key));
            setDraft((d) => ({ ...d, items: d.items.filter((i) => i.key !== item.key) }));
          }}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDraft((d) => ({ ...d, items: [...d.items, newItem(allUids)] }))}
          className={buttonClass('secondary', 'sm')}
        >
          Añadir ítem
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => setBulkOpen((o) => !o)}
          className={buttonClass('secondary', 'sm', 'border-brand-600 text-brand-800')}
        >
          Asignar a… {selected.length > 0 && `(${selected.length})`}
        </button>
      </div>
      {bulkOpen && selected.length > 0 && (
        <div role="group" aria-label="Asignar ítems seleccionados" className="space-y-2 rounded-xl bg-slate-50 p-3">
          <MemberChips label="Beneficiarios de los ítems seleccionados" options={members} selected={bulkUids} onChange={setBulkUids} />
          <button
            type="button"
            onClick={() => {
              setDraft((d) => assignInBulk(d, selected, bulkUids));
              setBulkOpen(false);
              setSelected([]);
            }}
            className={buttonClass('primary', 'sm')}
          >
            Aplicar
          </button>
        </div>
      )}
    </section>
  );
}
