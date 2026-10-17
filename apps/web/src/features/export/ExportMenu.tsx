import { FilePdfIcon, FileXlsIcon } from '@phosphor-icons/react';
import { buttonClass } from '../../components/ui/Button';
import type { ExportFormat, TripExport, TripExportPage } from 'contracts';
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { api } from '../../lib/apiClient';
import { RequiresOnline } from '../offline/RequiresOnline';
import { exportFileName } from './exportModel';

/** Fetches every privacy-filtered page (the first one carries the header and is audited). */
async function fetchExport(tripId: string, format: ExportFormat, onProgress: (n: number, of: number) => void): Promise<TripExport> {
  let page = await api<TripExportPage>('GET', `/trips/${tripId}/export`, { query: { format } });
  const header = page.header!;
  const all = { expenses: [...page.expenses], voidedExpenses: [...page.voidedExpenses], refunds: [...page.refunds] };
  onProgress(all.expenses.length + all.voidedExpenses.length, header.registeredCount);
  while (page.nextCursor) {
    page = await api<TripExportPage>('GET', `/trips/${tripId}/export`, { query: { format, cursor: page.nextCursor } });
    all.expenses.push(...page.expenses);
    all.voidedExpenses.push(...page.voidedExpenses);
    all.refunds.push(...page.refunds);
    onProgress(all.expenses.length + all.voidedExpenses.length, header.registeredCount);
  }
  return { ...header, ...all };
}

/** The file only exists in this browser's memory and goes straight to the requester (FR-018). */
function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** US4 / RF-19: detailed Excel and summary PDF, generated on demand. */
export function ExportMenu({ tripId }: { tripId: string }) {
  const [busy, setBusy] = useState<{ format: ExportFormat; done: number; of: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(format: ExportFormat) {
    setError(null);
    setBusy({ format, done: 0, of: 0 });
    try {
      const exp = await fetchExport(tripId, format, (done, of) => setBusy({ format, done, of }));
      const blob = format === 'xlsx' ? await (await import('./toXlsx')).toXlsxBlob(exp) : await (await import('./toPdf')).toPdfBlob(exp);
      download(blob, exportFileName(exp, format));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="export-title" className="space-y-2">
      <h2 id="export-title" className="text-lg font-semibold tracking-tight">
        Exportar
      </h2>
      <RequiresOnline label="Exportar">
        <div className="flex flex-wrap gap-2">
          {(['xlsx', 'pdf'] as const).map((f) => (
            <button
              key={f}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(f)}
              className={buttonClass('secondary', 'md')}
            >
              {f === 'xlsx' ? <FileXlsIcon size={20} className="text-emerald-700" /> : <FilePdfIcon size={20} className="text-rose-700" />}
              {f === 'xlsx' ? 'Excel detallado' : 'PDF resumen'}
            </button>
          ))}
        </div>
      </RequiresOnline>
      {busy && (
        <p role="status" className="text-sm text-slate-700">
          Preparando… {busy.done > 0 ? `${busy.done} de ${Math.max(busy.of, busy.done)} gastos` : ''}
        </p>
      )}
      <p className="text-xs text-slate-600">El archivo se genera en tu dispositivo y no queda guardado en ningún enlace.</p>
      <ErrorMessage error={error} />
    </section>
  );
}
