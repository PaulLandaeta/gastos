import type { FormEvent, ReactNode } from 'react';
import { Field, inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { formatMoney } from '../../lib/format';
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
    <section className="space-y-3 rounded-2xl border border-slate-200 p-4" aria-label={title}>
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
        <Field id="exp-description" label="Descripción" {...(flagged('description') ? { hint: `⚠️ ${REVIEW_HINT}` } : {})}>
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
          <p id="exp-total-review" className="text-xs text-amber-900">
            ⚠️ {REVIEW_HINT}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field id="exp-category" label="Categoría">
            <select
              id="exp-category"
              className={inputClass}
              value={draft.categoryId}
              onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="exp-date" label="Fecha de la transacción" {...(flagged('transactionDate') ? { hint: `⚠️ ${REVIEW_HINT}` } : {})}>
            <input
              id="exp-date"
              aria-describedby={flagged('transactionDate') ? 'exp-date-hint' : undefined}
              type="date"
              className={inputClass}
              value={draft.transactionDate}
              onChange={(e) => setDraft((d) => ({ ...d, transactionDate: e.target.value }))}
            />
          </Field>
        </div>
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
          <div className="grid grid-cols-2 gap-3">
            <Field id="exp-svc-start" label="Inicio del servicio">
              <input
                id="exp-svc-start"
                type="date"
                className={inputClass}
                value={draft.servicePeriod.startDate}
                onChange={(e) => setDraft((d) => ({ ...d, servicePeriod: { ...d.servicePeriod!, startDate: e.target.value } }))}
              />
            </Field>
            <Field id="exp-svc-end" label="Fin del servicio">
              <input
                id="exp-svc-end"
                type="date"
                className={inputClass}
                value={draft.servicePeriod.endDate}
                onChange={(e) => setDraft((d) => ({ ...d, servicePeriod: { ...d.servicePeriod!, endDate: e.target.value } }))}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Reparto">
        <div role="radiogroup" aria-label="Modo de reparto" className="inline-flex rounded-lg border border-slate-300 p-0.5">
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
              className="rounded-md px-3 py-1.5 text-sm aria-checked:bg-brand-700 aria-checked:text-white"
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
