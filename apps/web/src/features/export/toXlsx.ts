import type { TripExport } from 'contracts';
import { minorUnits } from 'finance-engine';
import { buildSheets } from './exportModel';

/** Builds the detailed Excel in the browser (write-excel-file loaded on demand). */
export async function toXlsxBlob(exp: TripExport): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const format = minorUnits(exp.trip.currency) === 0 ? '#,##0' : `#,##0.${'0'.repeat(minorUnits(exp.trip.currency))}`;
  const sheets = buildSheets(exp).map((s) => ({
    sheet: s.name,
    stickyRowsCount: 1,
    columns: s.columns.map((c) => ({ width: c.width ?? 14 })),
    data: [
      s.columns.map((c) => ({ value: c.header, fontWeight: 'bold' as const })),
      ...s.rows.map((row) =>
        row.map((value, i) =>
          typeof value === 'number' && s.columns[i]?.money ? { value, type: Number, format } : { value: value ?? undefined },
        ),
      ),
    ],
  }));
  return writeExcelFile(sheets as never).toBlob();
}
