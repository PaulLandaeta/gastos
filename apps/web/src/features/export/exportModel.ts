import type { ExportExpense, TripExport } from 'contracts';
import { minorUnits } from 'finance-engine';
import { formatDate, formatMoney } from '../../lib/format';

/**
 * Pure model of the export files (feature 005, RF-19). Every total is added up in integer minor
 * units and only converted for display, so the file matches the app to the cent.
 */
export type CellValue = string | number | null;

export interface Column {
  header: string;
  money?: boolean;
  width?: number;
}

export interface SheetModel {
  name: string;
  columns: Column[];
  rows: CellValue[][];
}

/** Minor units → number in major units, built from the decimal string (no float arithmetic). */
export function toMajor(minor: number, currency: string): number {
  const d = minorUnits(currency);
  if (d === 0) return minor;
  const digits = String(Math.abs(minor)).padStart(d + 1, '0');
  return Number(`${minor < 0 ? '-' : ''}${digits.slice(0, -d)}.${digits.slice(-d)}`);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const STATUS: Record<string, string> = {
  active: 'Vigente',
  voided: 'Anulado',
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  closed: 'Cerrado',
  archived: 'Archivado',
};
const ADJUSTMENT: Record<string, string> = { discount: 'Descuento', tax: 'Impuesto', tip: 'Propina' };

export const SCOPE_NOTICE = 'Incluye solo los gastos que puedes ver. Los saldos y deudas son los de todo el viaje.';

function helpers(exp: TripExport) {
  const names = new Map(exp.members.map((m) => [m.uid, m.displayName]));
  const categories = new Map(exp.categories.map((c) => [c.id, c.name]));
  const money = (minor: number) => toMajor(minor, exp.trip.currency);
  return {
    name: (uid: string) => names.get(uid) ?? 'Participante',
    category: (id: string) => categories.get(id) ?? id,
    money,
  };
}

function expenseRows(exp: TripExport, list: ExportExpense[]) {
  const h = helpers(exp);
  return list.map((e) => [
    e.seq,
    e.transactionDate,
    e.createdAt.slice(0, 10),
    e.description,
    h.category(e.categoryId),
    h.money(e.totalMinor),
    h.money(e.sharedMinor),
    h.money(e.personalMinor),
    e.payers.map((p) => `${h.name(p.uid)} (${formatMoney(p.amountMinor, exp.trip.currency)})`).join(', '),
    STATUS[e.status] ?? e.status,
    e.source === 'ai' ? 'Escaneado' : 'Manual',
  ]);
}

const EXPENSE_COLUMNS: Column[] = [
  { header: 'N.º', width: 6 },
  { header: 'Fecha', width: 12 },
  { header: 'Registrado', width: 12 },
  { header: 'Descripción', width: 32 },
  { header: 'Categoría', width: 16 },
  { header: 'Total', money: true, width: 12 },
  { header: 'Compartido', money: true, width: 12 },
  { header: 'Personal', money: true, width: 12 },
  { header: 'Pagadores', width: 32 },
  { header: 'Estado', width: 10 },
  { header: 'Origen', width: 10 },
];

/** Detailed Excel (FR-016): one sheet per kind of data, totals that match the app. */
export function buildSheets(exp: TripExport): SheetModel[] {
  const h = helpers(exp);
  const active = [...exp.expenses].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.seq - b.seq);
  const bySeq = new Map([...exp.expenses, ...exp.voidedExpenses].map((e) => [e.id, e]));

  const summary: CellValue[][] = [
    ['Viaje', exp.trip.name],
    ['Moneda', exp.trip.currency],
    ['Periodo', `${exp.trip.startDate} – ${exp.trip.endDate}`],
    ['Estado', STATUS[exp.trip.status] ?? exp.trip.status],
    ['Generado', exp.generatedAt.slice(0, 16).replace('T', ' ')],
    ['Por', exp.generatedBy.displayName],
    ...(exp.scope === 'visible' ? [['Alcance', SCOPE_NOTICE] as CellValue[]] : []),
    ['Total compartido', h.money(exp.totals.sharedMinor)],
    ['Total personal', h.money(exp.totals.personalMinor)],
    ...exp.totals.byCategory.map((c) => [`Categoría: ${c.name}`, h.money(c.totalMinor)] as CellValue[]),
  ];

  return [
    { name: 'Resumen', columns: [{ header: 'Dato', width: 22 }, { header: 'Valor', width: 40 }], rows: summary },
    {
      name: 'Gastos',
      columns: EXPENSE_COLUMNS,
      rows: [
        ...expenseRows(exp, active),
        ['', '', '', 'Total', '', h.money(sum(active.map((e) => e.totalMinor))), h.money(sum(active.map((e) => e.sharedMinor))), h.money(sum(active.map((e) => e.personalMinor))), '', '', ''],
      ],
    },
    {
      name: 'Ítems',
      columns: [
        { header: 'N.º gasto', width: 8 },
        { header: 'Gasto', width: 28 },
        { header: 'Ítem', width: 28 },
        { header: 'Cantidad', width: 9 },
        { header: 'Bruto', money: true, width: 12 },
        { header: 'Descuento', money: true, width: 12 },
        { header: 'Neto', money: true, width: 12 },
        { header: 'Tipo', width: 11 },
        { header: 'Beneficiarios', width: 32 },
      ],
      rows: active.flatMap((e) =>
        e.items.map((i) => [
          e.seq,
          e.description,
          i.description ?? '',
          i.quantity,
          h.money(i.grossMinor),
          h.money(i.discountMinor),
          h.money(i.grossMinor - i.discountMinor),
          i.classification === 'personal' ? 'Personal' : 'Compartido',
          i.beneficiaries.map(h.name).join(', '),
        ]),
      ),
    },
    {
      name: 'Reparto',
      columns: [
        { header: 'N.º gasto', width: 8 },
        { header: 'Gasto', width: 28 },
        { header: 'Persona', width: 20 },
        { header: 'Pagó', money: true, width: 12 },
        { header: 'Consume', money: true, width: 12 },
      ],
      rows: active.flatMap((e) => {
        const people = [...new Set([...e.payers.map((p) => p.uid), ...e.allocations.map((a) => a.uid)])];
        return people.map((uid) => [
          e.seq,
          e.description,
          h.name(uid),
          h.money(sum(e.payers.filter((p) => p.uid === uid).map((p) => p.amountMinor))),
          h.money(sum(e.allocations.filter((a) => a.uid === uid).map((a) => a.amountMinor))),
        ]);
      }),
    },
    {
      name: 'Ajustes',
      columns: [{ header: 'N.º gasto', width: 8 }, { header: 'Gasto', width: 28 }, { header: 'Tipo', width: 12 }, { header: 'Importe', money: true, width: 12 }],
      rows: active.flatMap((e) => e.adjustments.map((a) => [e.seq, e.description, ADJUSTMENT[a.kind] ?? a.kind, h.money(a.amountMinor)])),
    },
    {
      name: 'Pagos',
      columns: [
        { header: 'Fecha', width: 12 },
        { header: 'De', width: 20 },
        { header: 'Para', width: 20 },
        { header: 'Importe', money: true, width: 12 },
        { header: 'Estado', width: 12 },
      ],
      rows: exp.settlements.map((s) => [s.createdAt?.slice(0, 10) ?? '', h.name(s.fromUid), h.name(s.toUid), h.money(s.amountMinor), STATUS[s.status] ?? s.status]),
    },
    {
      name: 'Devoluciones',
      columns: [
        { header: 'Fecha', width: 12 },
        { header: 'N.º gasto', width: 8 },
        { header: 'Gasto', width: 28 },
        { header: 'Para', width: 20 },
        { header: 'Cantidad', width: 9 },
        { header: 'Importe', money: true, width: 12 },
      ],
      rows: exp.refunds.map((r) => {
        const e = bySeq.get(r.expenseId);
        return [r.createdAt?.slice(0, 10) ?? '', e?.seq ?? '', e?.description ?? '', h.name(r.recipientUid), r.quantity, h.money(r.amountMinor)];
      }),
    },
    {
      name: 'Saldos',
      columns: [{ header: 'Persona', width: 20 }, { header: 'Aportó', money: true, width: 12 }, { header: 'Consumió', money: true, width: 12 }, { header: 'Saldo', money: true, width: 12 }],
      rows: exp.balances.map((b) => [
        h.name(b.uid),
        b.paidMinor === null ? null : h.money(b.paidMinor),
        b.consumedMinor === null ? null : h.money(b.consumedMinor),
        h.money(b.netMinor),
      ]),
    },
    {
      name: 'Deudas',
      columns: [{ header: 'Vista', width: 14 }, { header: 'Debe', width: 20 }, { header: 'A', width: 20 }, { header: 'Importe', money: true, width: 12 }],
      rows: [
        ...exp.debts.simplified.map((d) => ['Simplificada', h.name(d.fromUid), h.name(d.toUid), h.money(d.amountMinor)]),
        ...exp.debts.original.map((d) => ['Original', h.name(d.fromUid), h.name(d.toUid), h.money(d.amountMinor)]),
      ],
    },
    { name: 'Anulados', columns: EXPENSE_COLUMNS, rows: expenseRows(exp, exp.voidedExpenses) },
  ];
}

export interface PdfSection {
  heading: string;
  head: string[];
  body: string[][];
}

export interface PdfModel {
  title: string;
  subtitle: string;
  notice: string | null;
  sections: PdfSection[];
  footer: string;
}

/** Summary PDF (FR-017): totals, categories, contribution/consumption, who owes whom. */
export function buildPdfModel(exp: TripExport): PdfModel {
  const h = helpers(exp);
  const fmt = (minor: number | null) => (minor === null ? '—' : formatMoney(minor, exp.trip.currency));
  return {
    title: exp.trip.name,
    subtitle: `${formatDate(exp.trip.startDate)} – ${formatDate(exp.trip.endDate)} · ${exp.trip.currency} · ${STATUS[exp.trip.status] ?? exp.trip.status}`,
    notice: exp.scope === 'visible' ? SCOPE_NOTICE : null,
    sections: [
      {
        heading: 'Totales',
        head: ['Concepto', 'Importe'],
        body: [
          ['Total compartido', fmt(exp.totals.sharedMinor)],
          ['Total personal', fmt(exp.totals.personalMinor)],
          ['Gastos incluidos', String(exp.expenses.length)],
        ],
      },
      {
        heading: 'Por categoría',
        head: ['Categoría', 'Importe'],
        body: exp.totals.byCategory.map((c) => [c.name, fmt(c.totalMinor)]),
      },
      {
        heading: 'Aporte y consumo por persona',
        head: ['Persona', 'Aportó', 'Consumió', 'Saldo'],
        body: exp.balances.map((b) => [h.name(b.uid), fmt(b.paidMinor), fmt(b.consumedMinor), fmt(b.netMinor)]),
      },
      {
        heading: 'Quién debe a quién',
        head: ['Debe', 'A', 'Importe'],
        body: exp.debts.simplified.map((d) => [h.name(d.fromUid), h.name(d.toUid), fmt(d.amountMinor)]),
      },
    ],
    footer: `Generado el ${exp.generatedAt.slice(0, 16).replace('T', ' ')} por ${exp.generatedBy.displayName}`,
  };
}

/** `gastos-{viaje}-{AAAA-MM-DD}.{ext}` with a filesystem-safe trip name. */
export function exportFileName(exp: TripExport, ext: 'xlsx' | 'pdf'): string {
  const slug = exp.trip.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `gastos-${slug || 'viaje'}-${exp.generatedAt.slice(0, 10)}.${ext}`;
}
