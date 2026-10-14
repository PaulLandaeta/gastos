import type { ReceiptDraft } from 'contracts';
import { newItem, newKey, type DraftAdjustment, type ExpenseDraft } from '../expenses/expenseFormModel';

export interface ScanPrefill {
  draft: ExpenseDraft;
  /** Form fields to review (low confidence or corrected): description, transactionDate, totalMinor. */
  reviewFields: string[];
  /** Item rows to review, as form item keys. */
  reviewItemKeys: string[];
}

const adjustment = (kind: DraftAdjustment['kind'], amountMinor: number): DraftAdjustment => ({
  key: newKey('a'),
  kind,
  amountMinor,
  mode: 'proportional',
  manual: {},
});

/**
 * FR-010/FR-011: turns the validated AI draft into the manual form's draft. Items keep quantities
 * and amounts, tax/tip/discount become proportional adjustments, and the detected date becomes the
 * transaction date. Beneficiaries default to everyone (the user decides before saving).
 */
export function draftToFormDraft(receipt: ReceiptDraft, base: ExpenseDraft, memberUids: string[]): ScanPrefill {
  const items = receipt.items.map((it) => ({
    ...newItem(memberUids),
    description: it.description,
    grossMinor: it.totalMinor,
    discountMinor: 0,
    quantity: it.quantity,
  }));
  const adjustments: DraftAdjustment[] = [];
  if (receipt.discountMinor > 0) adjustments.push(adjustment('discount', receipt.discountMinor));
  if (receipt.taxMinor > 0) adjustments.push(adjustment('tax', receipt.taxMinor));
  if (receipt.tipMinor > 0) adjustments.push(adjustment('tip', receipt.tipMinor));
  const computedTotal = items.length
    ? items.reduce((a, i) => a + (i.grossMinor ?? 0), 0) + receipt.taxMinor + receipt.tipMinor - receipt.discountMinor
    : null;

  const draft: ExpenseDraft = {
    ...base,
    description: (receipt.merchant ?? 'Compra escaneada').slice(0, 120),
    transactionDate: receipt.transactionDate,
    splitMode: items.length ? 'items' : 'total',
    totalMinor: receipt.totalMinor ?? computedTotal,
    items: items.length ? items : [newItem(memberUids)],
    adjustments,
  };

  const fieldOf: Record<string, string> = { merchant: 'description', transactionDate: 'transactionDate', total: 'totalMinor' };
  const reviewFields = new Set<string>();
  const reviewItemKeys: string[] = [];
  for (const key of receipt.lowConfidence) {
    const item = /^items\.(\d+)$/.exec(key);
    if (item) {
      const row = items[Number(item[1])];
      if (row) reviewItemKeys.push(row.key);
    } else if (fieldOf[key]) reviewFields.add(fieldOf[key]);
  }
  if (!receipt.merchant) reviewFields.add('description');
  if (receipt.totalMinor === undefined || receipt.warnings.includes('TOTAL_MISMATCH')) reviewFields.add('totalMinor');
  return { draft, reviewFields: [...reviewFields], reviewItemKeys };
}
