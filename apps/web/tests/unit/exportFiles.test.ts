import type { TripExport } from 'contracts';
import readExcelFile from 'read-excel-file/universal';
import { describe, expect, it } from 'vitest';
import { buildPdfModel, buildSheets, exportFileName, SCOPE_NOTICE, toMajor } from '../../src/features/export/exportModel';
import { toPdfBlob } from '../../src/features/export/toPdf';
import { toXlsxBlob } from '../../src/features/export/toXlsx';

function fixture(overrides: Partial<TripExport> = {}): TripExport {
  return {
    trip: { id: 't1', name: 'Uyuni Ñandú', currency: 'USD', status: 'closed', startDate: '2026-11-01', endDate: '2026-11-05' },
    generatedAt: '2026-11-06T10:30:00.000Z',
    generatedBy: { uid: 'pedro', displayName: 'Pedro' },
    scope: 'visible',
    registeredCount: 3,
    members: [
      { uid: 'ana', displayName: 'Ana' },
      { uid: 'pedro', displayName: 'Pedro' },
      { uid: 'juan', displayName: 'Juan' },
    ],
    categories: [{ id: 'default-food', name: 'Comida' }],
    settlements: [{ id: 's1', fromUid: 'pedro', toUid: 'ana', amountMinor: 333, status: 'confirmed', createdAt: '2026-11-03T00:00:00Z', resolvedAt: null }],
    balances: [
      { uid: 'ana', paidMinor: null, consumedMinor: null, netMinor: 667 },
      { uid: 'pedro', paidMinor: 0, consumedMinor: 333, netMinor: 0 },
      { uid: 'juan', paidMinor: null, consumedMinor: null, netMinor: -667 },
    ],
    debts: { original: [{ fromUid: 'juan', toUid: 'ana', amountMinor: 667 }], simplified: [{ fromUid: 'juan', toUid: 'ana', amountMinor: 667 }] },
    totals: { sharedMinor: 1000, personalMinor: 0, byCategory: [{ categoryId: 'default-food', name: 'Comida', totalMinor: 1000 }] },
    expenses: [
      {
        id: 'e2',
        seq: 2,
        transactionDate: '2026-11-02',
        createdAt: '2026-11-02T20:00:00.000Z',
        description: 'Taxi',
        categoryId: 'default-food',
        totalMinor: 1000,
        sharedMinor: 1000,
        personalMinor: 0,
        status: 'active',
        source: 'manual',
        payers: [{ uid: 'ana', amountMinor: 1000 }],
        allocations: [
          { uid: 'ana', amountMinor: 334 },
          { uid: 'pedro', amountMinor: 333 },
          { uid: 'juan', amountMinor: 333 },
        ],
        items: [{ description: null, quantity: 1, grossMinor: 1000, discountMinor: 0, classification: 'shared', beneficiaries: ['ana', 'pedro', 'juan'] }],
        adjustments: [],
      },
    ],
    voidedExpenses: [],
    refunds: [],
    ...overrides,
  };
}

describe('export model (FR-016/FR-017)', () => {
  it('converts minor units exactly, honouring currencies without decimals', () => {
    expect(toMajor(1000, 'USD')).toBe(10);
    expect(toMajor(333, 'USD')).toBe(3.33);
    expect(toMajor(-5, 'USD')).toBe(-0.05);
    expect(toMajor(1500, 'JPY')).toBe(1500);
  });

  it('builds every sheet, with totals added in integers', () => {
    const sheets = buildSheets(fixture());
    expect(sheets.map((s) => s.name)).toEqual(['Resumen', 'Gastos', 'Ítems', 'Reparto', 'Ajustes', 'Pagos', 'Devoluciones', 'Saldos', 'Deudas', 'Anulados']);
    const gastos = sheets.find((s) => s.name === 'Gastos')!;
    expect(gastos.rows.at(-1)!.slice(3, 6)).toEqual(['Total', '', 10]);
    const reparto = sheets.find((s) => s.name === 'Reparto')!;
    const consumed = reparto.rows.map((r) => Math.round((r[4] as number) * 100));
    expect(consumed.reduce((a, b) => a + b, 0)).toBe(1000); // 3,34 + 3,33 + 3,33 = 10,00
    const saldos = sheets.find((s) => s.name === 'Saldos')!;
    expect(saldos.rows).toEqual([
      ['Ana', null, null, 6.67],
      ['Pedro', 0, 3.33, 0],
      ['Juan', null, null, -6.67],
    ]);
    expect(sheets.find((s) => s.name === 'Deudas')!.rows).toEqual([
      ['Simplificada', 'Juan', 'Ana', 6.67],
      ['Original', 'Juan', 'Ana', 6.67],
    ]);
    expect(sheets.find((s) => s.name === 'Resumen')!.rows).toContainEqual(['Alcance', SCOPE_NOTICE]);
  });

  it('voided expenses are listed apart and excluded from totals (FR-019)', () => {
    const voided = { ...fixture().expenses[0]!, id: 'e3', seq: 3, description: 'Duplicado', status: 'voided' as const };
    const sheets = buildSheets(fixture({ voidedExpenses: [voided] }));
    expect(sheets.find((s) => s.name === 'Anulados')!.rows.map((r) => r[3])).toEqual(['Duplicado']);
    expect(sheets.find((s) => s.name === 'Gastos')!.rows.at(-1)![5]).toBe(10);
  });

  it('PDF summary: totals, categories, per person (— when not visible), debts and date', () => {
    const pdf = buildPdfModel(fixture());
    expect(pdf.notice).toBe(SCOPE_NOTICE);
    expect(pdf.sections.map((s) => s.heading)).toEqual(['Totales', 'Por categoría', 'Aporte y consumo por persona', 'Quién debe a quién']);
    expect(pdf.sections[2]!.body[0]).toEqual(['Ana', '—', '—', expect.stringContaining('6,67')]);
    expect(pdf.footer).toContain('2026-11-06 10:30');
    expect(buildPdfModel(fixture({ scope: 'all' })).notice).toBeNull();
  });

  it('file names are safe and dated', () => {
    expect(exportFileName(fixture(), 'xlsx')).toBe('gastos-uyuni-nandu-2026-11-06.xlsx');
  });
});

describe('generated files', () => {
  it('the .xlsx opens and its cells hold numbers that add up', async () => {
    const blob = await toXlsxBlob(fixture());
    const sheets = await readExcelFile(blob);
    expect(sheets.map((s) => s.sheet)).toContain('Gastos');
    const gastos = sheets.find((s) => s.sheet === 'Gastos')!.data;
    expect(gastos[0]![3]).toBe('Descripción');
    expect(gastos[1]![3]).toBe('Taxi');
    expect(gastos[1]![5]).toBe(10);
  });

  it('the PDF is generated', async () => {
    const blob = await toPdfBlob(fixture());
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(blob.size).toBeGreaterThan(1000);
  });
});
