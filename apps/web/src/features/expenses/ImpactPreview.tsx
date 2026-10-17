import { buttonClass } from '../../components/ui/Button';
import type { PreviewResponse } from 'contracts';
import { formatMoney } from '../../lib/format';

/** RF-28: balances before/after a change, per person, with explicit confirmation. */
export function ImpactPreview({
  preview,
  currency,
  nameOf,
  onConfirm,
  onCancel,
  busy,
}: {
  preview: PreviewResponse;
  currency: string;
  nameOf: (uid: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <section aria-label="Impacto en saldos" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <h2 className="font-semibold text-amber-950">Impacto en saldos</h2>
      <p className="text-sm text-amber-950">Ya hay pagos confirmados en este viaje. Revisa cómo cambian los saldos antes de confirmar.</p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-slate-700">
            <th scope="col">Persona</th>
            <th scope="col">Antes</th>
            <th scope="col">Después</th>
            <th scope="col">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {preview.after.map((row, i) => {
            const before = preview.before[i]!.netMinor;
            const delta = preview.delta[i]!.netMinor;
            return (
              <tr key={row.uid}>
                <th scope="row" className="font-normal">
                  {nameOf(row.uid)}
                </th>
                <td className="tabular-nums">{money(before)}</td>
                <td className="tabular-nums">{money(row.netMinor)}</td>
                <td className={`tabular-nums font-medium ${delta === 0 ? 'text-slate-600' : delta > 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                  {delta > 0 ? '+' : ''}
                  {money(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={onConfirm} className={buttonClass('primary', 'md', 'bg-amber-700 hover:bg-amber-800')}>
          Confirmar cambios
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('secondary', 'md')}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
