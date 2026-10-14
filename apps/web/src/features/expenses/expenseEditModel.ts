import { newKey, type AllocationMode, type DraftAdjustment, type DraftItem, type ExpenseDraft, toBody } from './expenseFormModel';
import type { ExpenseView } from './useExpenses';

type StoredItem = ExpenseView['items'][number] & {
  quantity?: number;
  allocation: { mode: AllocationMode; shares?: { uid: string; amountMinor?: number; bp?: number }[] };
};
type StoredAdjustment = ExpenseView['adjustments'][number] & { manualShares?: { uid: string; amountMinor: number }[] };

/** Builds an editable draft from a stored expense (same form as creation, feature 003). */
export function fromExpense(e: ExpenseView): ExpenseDraft {
  const items: DraftItem[] = (e.items as StoredItem[]).map((i) => ({
    key: i.id,
    description: i.description ?? '',
    grossMinor: i.grossMinor,
    discountMinor: i.discountMinor || null,
    classification: i.classification,
    quantity: i.quantity ?? 1,
    beneficiaries: [...i.beneficiaries],
    mode: i.allocation.mode,
    fixed: Object.fromEntries((i.allocation.shares ?? []).filter((s) => s.amountMinor !== undefined).map((s) => [s.uid, s.amountMinor!])),
    percentBp: Object.fromEntries((i.allocation.shares ?? []).filter((s) => s.bp !== undefined).map((s) => [s.uid, s.bp!])),
  }));
  const adjustments: DraftAdjustment[] = (e.adjustments as StoredAdjustment[]).map((a) => ({
    key: newKey('a'),
    kind: a.kind,
    amountMinor: a.amountMinor,
    mode: a.mode as DraftAdjustment['mode'],
    manual: Object.fromEntries((a.manualShares ?? []).map((m) => [m.uid, m.amountMinor])),
  }));
  return {
    description: e.description,
    categoryId: e.categoryId,
    transactionDate: e.transactionDate,
    servicePeriod: e.servicePeriod ?? null,
    notes: e.notes ?? '',
    splitMode: e.splitMode,
    totalMinor: e.totalMinor,
    items,
    adjustments,
    singlePayer: e.payers.length === 1,
    payers: e.payers.map((p) => ({ uid: p.uid, amountMinor: p.amountMinor })),
  };
}

export const FIELD_LABEL: Record<string, string> = {
  description: 'Descripción',
  categoryId: 'Categoría',
  transactionDate: 'Fecha',
  servicePeriod: 'Periodo de servicio',
  notes: 'Notas',
  totalMinor: 'Importe total',
  payers: 'Pagadores',
  splitMode: 'Modo de reparto',
  items: 'Ítems',
  adjustments: 'Ajustes',
};

const normItems = (items: ReadonlyArray<Partial<StoredItem>>) =>
  items.map((i) => ({
    id: i.id,
    description: i.description ?? '',
    grossMinor: i.grossMinor,
    discountMinor: i.discountMinor ?? 0,
    quantity: i.quantity ?? 1,
    classification: i.classification,
    beneficiaries: [...(i.beneficiaries ?? [])].sort(),
    allocation: i.allocation,
  }));

const normAdjustments = (a: ReadonlyArray<Partial<StoredAdjustment>>) =>
  a.map((x) => ({ kind: x.kind, amountMinor: x.amountMinor, mode: x.mode, manualShares: x.manualShares ?? [] }));

/** Fields where the user's draft differs from the current stored version (conflict view, RF-36). */
export function diffDraft(draft: ExpenseDraft, current: ExpenseView): { field: string; label: string }[] {
  const mine = toBody(draft);
  const pairs: [string, unknown, unknown][] = [
    ['description', mine.description, current.description],
    ['categoryId', mine.categoryId, current.categoryId],
    ['transactionDate', mine.transactionDate, current.transactionDate],
    ['servicePeriod', mine.servicePeriod ?? null, current.servicePeriod ?? null],
    ['notes', mine.notes ?? '', current.notes ?? ''],
    ['totalMinor', mine.totalMinor, current.totalMinor],
    ['payers', mine.payers, current.payers],
    ['splitMode', mine.splitMode, current.splitMode],
    ['items', normItems(mine.items as Partial<StoredItem>[]), normItems(current.items as StoredItem[])],
    ['adjustments', normAdjustments((mine.adjustments ?? []) as Partial<StoredAdjustment>[]), normAdjustments(current.adjustments as StoredAdjustment[])],
  ];
  return pairs
    .filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
    .map(([field]) => ({ field, label: FIELD_LABEL[field] ?? field }));
}
