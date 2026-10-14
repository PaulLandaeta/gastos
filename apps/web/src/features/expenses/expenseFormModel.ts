import type { CreateExpenseBody } from 'contracts';
import { EngineError, computeExpense, type ExpenseResult, type Member } from 'finance-engine';

/**
 * Pure model of the manual expense form. The live preview runs the very same finance engine as
 * the API (research R3), so what the user sees before saving is what gets stored.
 */

export type AllocationMode = 'equal' | 'fixed' | 'percent';

export interface DraftItem {
  key: string;
  description: string;
  grossMinor: number | null;
  discountMinor: number | null;
  classification: 'shared' | 'personal';
  /** Units bought (refunds by quantity, feature 003). */
  quantity: number;
  beneficiaries: string[];
  mode: AllocationMode;
  /** uid → minor units (fixed mode). */
  fixed: Record<string, number | null>;
  /** uid → basis points (percent mode, 10000 = 100,00 %). */
  percentBp: Record<string, number | null>;
}

export interface DraftAdjustment {
  key: string;
  kind: 'discount' | 'tax' | 'tip';
  amountMinor: number | null;
  mode: 'proportional' | 'equal' | 'manual';
  manual: Record<string, number | null>;
}

export interface ExpenseDraft {
  description: string;
  categoryId: string;
  transactionDate: string;
  servicePeriod: { startDate: string; endDate: string } | null;
  notes: string;
  splitMode: 'total' | 'items';
  /** Invoice total typed by the user (both modes). */
  totalMinor: number | null;
  /** In total mode, items[0] holds beneficiaries and allocation of the whole amount. */
  items: DraftItem[];
  adjustments: DraftAdjustment[];
  singlePayer: boolean;
  payers: { uid: string; amountMinor: number | null }[];
}

export type IssueCode =
  | 'DESCRIPTION'
  | 'CATEGORY'
  | 'TOTAL'
  | 'SERVICE_PERIOD'
  | 'NO_BENEFICIARY'
  | 'ITEM_AMOUNT'
  | 'FIXED_SUM'
  | 'PERCENT_SUM'
  | 'ADJUSTMENT'
  | 'ITEMS_DIFF'
  | 'PAYERS_DIFF'
  | 'PAYER'
  | 'ENGINE';

export interface Issue {
  code: IssueCode;
  message: string;
  itemKey?: string;
}

export interface Evaluation {
  ok: boolean;
  issues: Issue[];
  /** total − (items + adjustments); 0 when balanced. */
  difference: number;
  /** total − Σ payers; 0 when balanced. */
  payersDifference: number;
  result?: ExpenseResult;
}

let counter = 0;
export const newKey = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newItem(beneficiaries: string[], classification: 'shared' | 'personal' = 'shared'): DraftItem {
  return {
    key: newKey('i'),
    description: '',
    grossMinor: null,
    discountMinor: null,
    classification,
    quantity: 1,
    beneficiaries: classification === 'personal' ? beneficiaries.slice(0, 1) : [...beneficiaries],
    mode: 'equal',
    fixed: {},
    percentBp: {},
  };
}

export function newDraft(opts: { meUid: string; memberUids: string[]; today: string; categoryId: string }): ExpenseDraft {
  return {
    description: '',
    categoryId: opts.categoryId,
    transactionDate: opts.today,
    servicePeriod: null,
    notes: '',
    splitMode: 'total',
    totalMinor: null,
    items: [newItem(opts.memberUids)],
    adjustments: [],
    singlePayer: true,
    payers: [{ uid: opts.meUid, amountMinor: null }],
  };
}

const n = (v: number | null | undefined) => v ?? 0;
const signed = (a: DraftAdjustment) => (a.kind === 'discount' ? -n(a.amountMinor) : n(a.amountMinor));

function activeItems(d: ExpenseDraft): DraftItem[] {
  if (d.splitMode === 'total') {
    const first = d.items[0]!;
    return [{ ...first, grossMinor: d.totalMinor, discountMinor: 0 }];
  }
  return d.items;
}

function payersOf(d: ExpenseDraft) {
  return d.singlePayer ? [{ uid: d.payers[0]!.uid, amountMinor: n(d.totalMinor) }] : d.payers.map((p) => ({ uid: p.uid, amountMinor: n(p.amountMinor) }));
}

function allocationOf(item: DraftItem) {
  if (item.mode === 'fixed') {
    return { mode: 'fixed' as const, shares: item.beneficiaries.map((uid) => ({ uid, amountMinor: n(item.fixed[uid]) })) };
  }
  if (item.mode === 'percent') {
    return { mode: 'percent' as const, shares: item.beneficiaries.map((uid) => ({ uid, bp: n(item.percentBp[uid]) })) };
  }
  return { mode: 'equal' as const };
}

/** Maps the draft to the API body (contracts `CreateExpenseBody`). */
export function toBody(d: ExpenseDraft): CreateExpenseBody {
  const items = activeItems(d).map((item, index) => ({
    id: item.key,
    index,
    ...(item.description.trim() ? { description: item.description.trim() } : {}),
    grossMinor: n(item.grossMinor),
    discountMinor: n(item.discountMinor),
    quantity: Math.max(1, item.quantity || 1),
    classification: item.classification,
    beneficiaries: item.beneficiaries,
    allocation: allocationOf(item),
  }));
  return {
    description: d.description.trim(),
    categoryId: d.categoryId,
    transactionDate: d.transactionDate,
    ...(d.servicePeriod ? { servicePeriod: d.servicePeriod } : {}),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    totalMinor: n(d.totalMinor),
    payers: payersOf(d).filter((p) => p.amountMinor > 0),
    splitMode: d.splitMode,
    items,
    adjustments:
      d.splitMode === 'items'
        ? d.adjustments.map((a) => ({
            kind: a.kind,
            amountMinor: n(a.amountMinor),
            mode: a.mode,
            ...(a.mode === 'manual'
              ? { manualShares: Object.entries(a.manual).map(([uid, v]) => ({ uid, amountMinor: n(v) })).filter((s) => s.amountMinor > 0) }
              : {}),
          }))
        : [],
  };
}

const ENGINE_MESSAGES: Record<string, string> = {
  NOT_RECONCILED: 'Los importes no cuadran.',
  INVALID_PERCENT: 'Los porcentajes deben sumar exactamente 100,00 %.',
  ITEM_WITHOUT_BENEFICIARY: 'Hay ítems sin beneficiario.',
  DISCOUNT_EXCEEDS_ITEM: 'Un descuento supera el importe del ítem.',
  PAYER_NOT_MEMBER: 'Solo participantes del viaje pueden pagar.',
  INVALID_ALLOCATION: 'El reparto no es válido.',
};

/** Live validation (FR-011): differences, missing beneficiaries and the engine preview. */
export function evaluate(d: ExpenseDraft, members: Member[], provisionalSeq: number): Evaluation {
  const issues: Issue[] = [];
  if (!d.description.trim()) issues.push({ code: 'DESCRIPTION', message: 'Escribe una descripción.' });
  if (!d.categoryId) issues.push({ code: 'CATEGORY', message: 'Elige una categoría.' });
  if (!d.totalMinor || d.totalMinor <= 0) issues.push({ code: 'TOTAL', message: 'Indica el importe total.' });
  if (d.servicePeriod && d.servicePeriod.endDate < d.servicePeriod.startDate) {
    issues.push({ code: 'SERVICE_PERIOD', message: 'El fin del servicio es anterior al inicio.' });
  }

  const items = activeItems(d);
  for (const item of items) {
    if (item.beneficiaries.length === 0) {
      issues.push({ code: 'NO_BENEFICIARY', message: 'Ítem sin beneficiario.', itemKey: item.key });
    }
    if (d.splitMode === 'items' && (item.grossMinor === null || item.grossMinor <= 0)) {
      issues.push({ code: 'ITEM_AMOUNT', message: 'Ítem sin importe.', itemKey: item.key });
    }
    const net = n(item.grossMinor) - n(item.discountMinor);
    if (item.mode === 'fixed') {
      const sum = item.beneficiaries.reduce((a, uid) => a + n(item.fixed[uid]), 0);
      if (sum !== net) issues.push({ code: 'FIXED_SUM', message: 'Los importes fijos no suman el ítem.', itemKey: item.key });
    }
    if (item.mode === 'percent') {
      const sum = item.beneficiaries.reduce((a, uid) => a + n(item.percentBp[uid]), 0);
      if (sum !== 10_000) issues.push({ code: 'PERCENT_SUM', message: 'Los porcentajes deben sumar 100,00 %.', itemKey: item.key });
    }
  }
  if (d.splitMode === 'items') {
    for (const a of d.adjustments) {
      if (!a.amountMinor || a.amountMinor <= 0) issues.push({ code: 'ADJUSTMENT', message: 'Ajuste sin importe.' });
      if (a.mode === 'manual') {
        const sum = Object.values(a.manual).reduce<number>((acc, v) => acc + n(v), 0);
        if (sum !== n(a.amountMinor)) issues.push({ code: 'ADJUSTMENT', message: 'El reparto manual no suma el ajuste.' });
      }
    }
  }

  const itemsNet = items.reduce((a, i) => a + n(i.grossMinor) - n(i.discountMinor), 0);
  const adjustmentsNet = d.splitMode === 'items' ? d.adjustments.reduce((a, x) => a + signed(x), 0) : 0;
  const difference = n(d.totalMinor) - (itemsNet + adjustmentsNet);
  if (difference !== 0) issues.push({ code: 'ITEMS_DIFF', message: 'Los ítems y ajustes no cuadran con el total.' });

  const payers = payersOf(d);
  const payersDifference = n(d.totalMinor) - payers.reduce((a, p) => a + p.amountMinor, 0);
  if (payers.length === 0 || payers.every((p) => p.amountMinor === 0)) issues.push({ code: 'PAYER', message: 'Indica quién pagó.' });
  if (!d.singlePayer && payersDifference !== 0) issues.push({ code: 'PAYERS_DIFF', message: 'Los aportes no suman el total.' });

  let result: ExpenseResult | undefined;
  if (issues.length === 0) {
    const body = toBody(d);
    try {
      result = computeExpense({
        seq: provisionalSeq,
        totalMinor: body.totalMinor,
        payers: body.payers,
        splitMode: body.splitMode,
        items: body.items.map((i) => ({ ...i, discountMinor: i.discountMinor ?? 0 })) as Parameters<typeof computeExpense>[0]['items'],
        adjustments: (body.adjustments ?? []) as Parameters<typeof computeExpense>[0]['adjustments'],
        members,
      });
    } catch (e) {
      const code = e instanceof EngineError ? e.code : 'INVALID_ALLOCATION';
      issues.push({ code: 'ENGINE', message: ENGINE_MESSAGES[code] ?? 'El reparto no es válido.' });
    }
  }
  return { ok: issues.length === 0 && result !== undefined, issues, difference, payersDifference, ...(result ? { result } : {}) };
}

/** Bulk assignment (RF-27): same beneficiaries and mode for every selected item. */
export function assignInBulk(d: ExpenseDraft, itemKeys: string[], beneficiaries: string[]): ExpenseDraft {
  const set = new Set(itemKeys);
  return {
    ...d,
    items: d.items.map((i) =>
      set.has(i.key)
        ? {
            ...i,
            beneficiaries: i.classification === 'personal' ? beneficiaries.slice(0, 1) : [...beneficiaries],
            mode: 'equal',
            fixed: {},
            percentBp: {},
          }
        : i,
    ),
  };
}
