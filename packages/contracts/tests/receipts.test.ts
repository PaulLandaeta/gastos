import { describe, expect, it } from 'vitest';
import { RawReceiptDraft, draftWarnings, normalizeDraft } from '../src/index.js';

const raw = {
  merchant: { value: 'Super Ahorro', confidence: 0.95 },
  transactionDate: { value: '2026-11-02', confidence: 0.9 },
  detectedCurrency: 'USD',
  items: [
    { description: 'Pan', quantity: 2, unitPrice: 3.0, total: 6.0, confidence: 0.92 },
    { description: 'Agua', quantity: 1, unitPrice: 3.0, total: 3.0, confidence: 0.5 },
  ],
  subtotal: 9.0,
  tax: 0.9,
  tip: 0,
  discount: 0,
  total: { value: 9.9, confidence: 0.97 },
};

describe('normalizeDraft', () => {
  it('converts amounts to integer minor units of the trip currency (no floats kept)', () => {
    const d = normalizeDraft(RawReceiptDraft.parse(raw), { currency: 'USD', today: '2026-11-03' });
    expect(d.items.map((i) => [i.description, i.quantity, i.totalMinor])).toEqual([
      ['Pan', 2, 600],
      ['Agua', 1, 300],
    ]);
    expect(d).toMatchObject({ subtotalMinor: 900, taxMinor: 90, tipMinor: 0, totalMinor: 990, detectedCurrency: 'USD' });
    expect(d.transactionDate).toBe('2026-11-02');
    expect(d.lowConfidence).toEqual(['items.1']);
  });

  it('handles currencies without decimals and clamps invalid quantities/amounts', () => {
    const d = normalizeDraft(
      RawReceiptDraft.parse({ ...raw, detectedCurrency: 'JPY', items: [{ description: 'Ramen', quantity: 0, total: 950.4, confidence: 0.9 }, { description: 'Neg', quantity: 1, total: -5 }], total: { value: 950 } }),
      { currency: 'JPY', today: '2026-11-03' },
    );
    expect(d.items).toEqual([expect.objectContaining({ description: 'Ramen', quantity: 1, totalMinor: 950 })]);
    expect(d.warnings).toContain('LOW_CONFIDENCE');
  });

  it('flags future or impossible dates and proposes today', () => {
    const d = normalizeDraft(RawReceiptDraft.parse({ ...raw, transactionDate: { value: '2031-01-01', confidence: 0.9 } }), { currency: 'USD', today: '2026-11-03' });
    expect(d.transactionDate).toBe('2026-11-03');
    expect(d.warnings).toContain('DATE_SUSPICIOUS');
  });
});

describe('draftWarnings', () => {
  it('CURRENCY_MISMATCH, TOTAL_MISMATCH and EMPTY', () => {
    const base = normalizeDraft(RawReceiptDraft.parse(raw), { currency: 'BOB', today: '2026-11-03' });
    expect(base.warnings).toContain('CURRENCY_MISMATCH');
    const mismatch = normalizeDraft(RawReceiptDraft.parse({ ...raw, total: { value: 12, confidence: 0.9 } }), { currency: 'USD', today: '2026-11-03' });
    expect(draftWarnings(mismatch, 'USD')).toContain('TOTAL_MISMATCH');
    const empty = normalizeDraft(RawReceiptDraft.parse({ items: [] }), { currency: 'USD', today: '2026-11-03' });
    expect(empty.warnings).toContain('EMPTY');
  });

  it('rejects garbage from the provider at the schema level', () => {
    expect(RawReceiptDraft.safeParse({ items: 'nope' }).success).toBe(false);
  });
});
