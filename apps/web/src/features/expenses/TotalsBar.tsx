import { formatMoney } from '../../lib/format';
import type { Evaluation } from './expenseFormModel';

/** Sticky bar (FR-011): currency, total, live difference and the only Save button. */
export function TotalsBar({
  currency,
  totalMinor,
  evaluation,
  saving,
}: {
  currency: string;
  totalMinor: number | null;
  evaluation: Evaluation;
  saving: boolean;
}) {
  const { difference, payersDifference, ok, issues } = evaluation;
  let message = 'Cuadra';
  let tone = 'text-emerald-800';
  if (difference > 0) {
    message = `Faltan ${formatMoney(difference, currency)} en ítems y ajustes`;
    tone = 'text-amber-800';
  } else if (difference < 0) {
    message = `Sobran ${formatMoney(-difference, currency)} en ítems y ajustes`;
    tone = 'text-amber-800';
  } else if (payersDifference !== 0 && issues.some((i) => i.code === 'PAYERS_DIFF')) {
    message =
      payersDifference > 0
        ? `Faltan ${formatMoney(payersDifference, currency)} en los aportes`
        : `Sobran ${formatMoney(-payersDifference, currency)} en los aportes`;
    tone = 'text-amber-800';
  } else if (!ok) {
    message = issues[0]?.message ?? 'Completa el gasto';
    tone = 'text-slate-700';
  }
  return (
    <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div role="status" aria-label="Resumen del gasto" aria-live="polite" className="min-w-0">
          <p className="text-sm text-slate-600">
            Total <strong className="text-slate-900">{formatMoney(totalMinor ?? 0, currency)}</strong>
          </p>
          <p className={`truncate text-sm font-medium ${tone}`}>{message}</p>
        </div>
        <button
          type="submit"
          disabled={!ok || saving}
          className="shrink-0 rounded-xl bg-brand-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {saving ? 'Guardando…' : 'Guardar gasto'}
        </button>
      </div>
    </div>
  );
}
