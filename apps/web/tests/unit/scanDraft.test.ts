import type { ReceiptDraft } from 'contracts';
import { describe, expect, it } from 'vitest';
import { newDraft } from '../../src/features/expenses/expenseFormModel';
import { draftToFormDraft } from '../../src/features/scan/scanDraft';

const base = newDraft({ meUid: 'ana', memberUids: ['ana', 'pedro'], today: '2026-11-03', categoryId: 'default-food' });
const receipt: ReceiptDraft = {
  merchant: 'Super Ahorro',
  transactionDate: '2026-11-02',
  detectedCurrency: 'EUR',
  items: [
    { description: 'Pan', quantity: 2, unitPriceMinor: 300, totalMinor: 600 },
    { description: 'Agua', quantity: 1, totalMinor: 300 },
  ],
  taxMinor: 90,
  tipMinor: 50,
  discountMinor: 40,
  totalMinor: 1000,
  lowConfidence: ['items.1', 'transactionDate'],
  warnings: ['CURRENCY_MISMATCH', 'LOW_CONFIDENCE'],
};

describe('draftToFormDraft', () => {
  it('maps items with quantities, adjustments and the transaction date', () => {
    const { draft } = draftToFormDraft(receipt, base, ['ana', 'pedro']);
    expect(draft).toMatchObject({ description: 'Super Ahorro', transactionDate: '2026-11-02', splitMode: 'items', totalMinor: 1000 });
    expect(draft.items.map((i) => [i.description, i.quantity, i.grossMinor, i.beneficiaries])).toEqual([
      ['Pan', 2, 600, ['ana', 'pedro']],
      ['Agua', 1, 300, ['ana', 'pedro']],
    ]);
    expect(draft.adjustments.map((a) => [a.kind, a.amountMinor, a.mode])).toEqual([
      ['discount', 40, 'proportional'],
      ['tax', 90, 'proportional'],
      ['tip', 50, 'proportional'],
    ]);
    expect(draft.payers).toEqual(base.payers);
  });

  it('reports low-confidence fields and item rows to review', () => {
    const { draft, reviewFields, reviewItemKeys } = draftToFormDraft(receipt, base, ['ana', 'pedro']);
    expect(reviewFields).toEqual(['transactionDate']);
    expect(reviewItemKeys).toEqual([draft.items[1]!.key]);
  });

  it('empty receipts fall back to total mode and flag description and total', () => {
    const { draft, reviewFields } = draftToFormDraft(
      { transactionDate: '2026-11-03', items: [], taxMinor: 0, tipMinor: 0, discountMinor: 0, lowConfidence: [], warnings: ['EMPTY'] },
      base,
      ['ana', 'pedro'],
    );
    expect(draft).toMatchObject({ splitMode: 'total', totalMinor: null, description: 'Compra escaneada' });
    expect(reviewFields.sort()).toEqual(['description', 'totalMinor']);
  });

  it('without a printed total the sum of items and adjustments is proposed', () => {
    const { totalMinor: _omit, ...withoutTotal } = receipt;
    const { draft, reviewFields } = draftToFormDraft({ ...withoutTotal, lowConfidence: [] }, base, ['ana']);
    expect(draft.totalMinor).toBe(600 + 300 + 90 + 50 - 40);
    expect(reviewFields).toEqual(['totalMinor']);
  });
});
