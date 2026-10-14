import { formatMoney } from '../../lib/format';

export interface CategoryDatum {
  id: string;
  name: string;
  color: string;
  amountMinor: number;
}

/**
 * Single-series horizontal bars (magnitude per category). Identity comes from the direct text
 * label, not color (the category dot is decorative); one validated brand hue (#0d9488, dataviz
 * checks pass); 4px rounded data-ends; a visually hidden table mirrors the figure.
 */
export function CategoryChart({ data, currency, caption }: { data: CategoryDatum[]; currency: string; caption: string }) {
  const rows = [...data].filter((d) => d.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor);
  const max = Math.max(1, ...rows.map((r) => r.amountMinor));
  const total = rows.reduce((s, r) => s + r.amountMinor, 0);
  return (
    <figure aria-label={caption} className="space-y-2">
      <figcaption className="text-sm font-semibold text-slate-800">{caption}</figcaption>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">Sin gastos compartidos para mostrar.</p>
      ) : (
        <>
          <ul aria-hidden className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="group" title={`${r.name}: ${formatMoney(r.amountMinor, currency)} (${Math.round((r.amountMinor * 100) / total)} %)`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-slate-800">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.name}
                  </span>
                  <span className="tabular-nums text-slate-700">{formatMoney(r.amountMinor, currency)}</span>
                </div>
                <div className="mt-1 h-2.5 w-full">
                  <div
                    className="h-full rounded-r bg-[#0d9488] transition-[width] group-hover:bg-[#0f766e]"
                    style={{ width: `${Math.max(2, (r.amountMinor / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <table className="sr-only">
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Categoría</th>
                <th scope="col">Importe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td>{formatMoney(r.amountMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </figure>
  );
}
