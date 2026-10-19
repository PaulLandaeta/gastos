import { DateInput, DateRangeInputs } from '../../components/ui/DatePicker';
import { WarningIcon } from '@phosphor-icons/react';
import type { FormEvent, ReactNode } from 'react';
import { Field, inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { formatMoney } from '../../lib/format';
import { CategoryIcon } from '../../lib/categoryIcon';
import type { Category } from './useExpenses';
import { newItem, type Evaluation, type ExpenseDraft } from './expenseFormModel';
import { MemberChips, type MemberOption } from './MemberChips';
import { TotalsBar } from './TotalsBar';

export interface ExpenseFormProps {
  currency: string;
  members: MemberOption[];
  categories: Category[];
  draft: ExpenseDraft;
  setDraft: (updater: (d: ExpenseDraft) => ExpenseDraft) => void;
  evaluation: Evaluation;
  saving: boolean;
  onSubmit: () => void;
  /** Items/adjustments editors (US2) rendered in items mode. */
  itemsSection?: ReactNode;
  /** Multiple payers editor (US2). */
  payersSection?: ReactNode;
  children?: ReactNode;
  /** Fields flagged by the AI scan for review (FR-010): description, transactionDate, totalMinor. */
  review?: string[];
}

const REVIEW_HINT = 'Revisar: dato dudoso del escaneo';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/70 bg-surface shadow-card p-4" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ExpenseForm(props: ExpenseFormProps) {
  const { currency, members, categories, draft, setDraft, evaluation, saving } = props;
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.name ?? '—';
  const totalItem = draft.items[0]!;
  const flagged = (field: string) => props.review?.includes(field) ?? false;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (evaluation.ok && !saving) props.onSubmit();
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4 pb-2">
      <Section title="Datos del gasto">
        <Field id="exp-description" label="Descripción" {...(flagged('description') ? { hint: REVIEW_HINT, warn: true } : {})}>
          <input
            id="exp-description"
            aria-describedby={flagged('description') ? 'exp-description-hint' : undefined}
            className={inputClass}
            maxLength={120}
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </Field>
        <MoneyInput
          id="exp-total"
          label="Importe total"
          currency={currency}
          valueMinor={draft.totalMinor}
          onChange={(v) => setDraft((d) => ({ ...d, totalMinor: v }))}
          required
          {...(flagged('totalMinor') ? { describedBy: 'exp-total-review' } : {})}
        />
        {flagged('totalMinor') && (
          <p id="exp-total-review" className="flex items-center gap-1 text-xs text-amber-900">
            <WarningIcon weight="fill" size={14} className="shrink-0 text-amber-600" />
            {REVIEW_HINT}
          </p>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-1 block text-sm font-medium text-slate-800">Categoría</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label
                key={c.id}
                className="relative flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white py-1 pl-1 pr-3 text-sm font-medium text-slate-700 transition-colors has-checked:border-brand-600 has-checked:bg-brand-50 has-checked:text-brand-900 has-focus-visible:ring-2 has-focus-visible:ring-brand-600"
              >
                <input
                  type="radio"
                  name="exp-category"
                  value={c.id}
                  checked={draft.categoryId === c.id}
                  onChange={() => setDraft((d) => ({ ...d, categoryId: c.id }))}
                  className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
                />
                <CategoryIcon category={c} size="sm" />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="exp-date" label="Fecha de la transacción" {...(flagged('transactionDate') ? { hint: REVIEW_HINT, warn: true } : {})}>
          <DateInput
            id="exp-date"
            title="Fecha de la transacción"
            describedBy={flagged('transactionDate') ? 'exp-date-hint' : undefined}
            value={draft.transactionDate}
            onChange={(v) => setDraft((d) => ({ ...d, transactionDate: v }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.servicePeriod !== null}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                servicePeriod: e.target.checked ? { startDate: d.transactionDate, endDate: d.transactionDate } : null,
              }))
            }
          />
          Servicio de varios días (un solo gasto, sin reparto diario)
        </label>
        {draft.servicePeriod && (
          <DateRangeInputs
            start={{ id: 'exp-svc-start', label: 'Inicio del servicio' }}
            end={{ id: 'exp-svc-end', label: 'Fin del servicio' }}
            value={{ start: draft.servicePeriod.startDate, end: draft.servicePeriod.endDate }}
            onChange={(v) => setDraft((d) => ({ ...d, servicePeriod: { startDate: v.start, endDate: v.end } }))}
          />
        )}
      </Section>

      <Section title="Reparto">
        <div role="radiogroup" aria-label="Modo de reparto" className="inline-flex rounded-xl bg-slate-200/70 p-1">
          {(['total', 'items'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={draft.splitMode === mode}
              onClick={() =>
                setDraft((d) => {
                  if (d.splitMode === mode) return d;
                  // Starting an invoice: drop the untouched "whole amount" row; back to total: one row.
                  if (mode === 'items') {
                    const untouched = d.items.length === 1 && d.items[0]!.grossMinor === null && !d.items[0]!.description;
                    return { ...d, splitMode: mode, items: untouched ? [] : d.items };
                  }
                  return {
                    ...d,
                    splitMode: mode,
                    items: d.items.length > 0 ? d.items : [newItem(members.map((m) => m.uid))],
                  };
                })
              }
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 aria-checked:bg-white aria-checked:text-slate-900 aria-checked:shadow-card"
            >
              {mode === 'total' ? 'Repartir el total' : 'Por ítems de la factura'}
            </button>
          ))}
        </div>
        {draft.splitMode === 'total' ? (
          <>
            <MemberChips
              label="¿Entre quiénes?"
              options={members}
              selected={totalItem.beneficiaries}
              onChange={(uids) =>
                setDraft((d) => ({ ...d, items: [{ ...d.items[0]!, beneficiaries: uids }, ...d.items.slice(1)] }))
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={totalItem.classification === 'personal'}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    items: [
                      {
                        ...d.items[0]!,
                        classification: e.target.checked ? 'personal' : 'shared',
                        beneficiaries: e.target.checked ? d.items[0]!.beneficiaries.slice(0, 1) : d.items[0]!.beneficiaries,
                      },
                      ...d.items.slice(1),
                    ],
                  }))
                }
              />
              Gasto personal (de una sola persona, no cuenta como compartido)
            </label>
          </>
        ) : (
          props.itemsSection
        )}
        {evaluation.result && (
          <div aria-label="Reparto por persona" className="rounded-lg bg-slate-50 p-3">
            <p className="mb-1 text-sm font-medium">Reparto por persona</p>
            <ul className="space-y-0.5 text-sm">
              {Object.entries(evaluation.result.chargesByMember).map(([uid, c]) => (
                <li key={uid} className="flex justify-between gap-2">
                  <span>{nameOf(uid)}</span>
                  <span>
                    {formatMoney(c.netMinor, currency)}
                    {c.personalMinor > 0 && <span className="text-slate-500"> (personal {formatMoney(c.personalMinor, currency)})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Pagadores">
        {draft.singlePayer ? (
          <MemberChips
            label="¿Quién pagó?"
            options={members}
            single
            selected={[draft.payers[0]!.uid]}
            onChange={([uid]) => setDraft((d) => ({ ...d, payers: [{ uid: uid!, amountMinor: null }] }))}
          />
        ) : (
          props.payersSection
        )}
        {props.payersSection && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!draft.singlePayer}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  singlePayer: !e.target.checked,
                  payers: e.target.checked ? d.payers.map((p) => ({ ...p, amountMinor: d.totalMinor })) : d.payers.slice(0, 1),
                }))
              }
            />
            Varios pagadores
          </label>
        )}
      </Section>

      <Field id="exp-notes" label="Notas (opcional)">
        <textarea
          id="exp-notes"
          rows={2}
          maxLength={500}
          className={inputClass}
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
        />
      </Field>

      {props.children}
      <TotalsBar currency={currency} totalMinor={draft.totalMinor} evaluation={evaluation} saving={saving} />
    </form>
  );
}
