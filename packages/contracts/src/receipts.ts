import { z } from 'zod';
import { currencyDecimals } from './currencies.js';

/** Confidence below this value highlights the field in the form (RF-26). */
export const LOW_CONFIDENCE = 0.7;

const Num = z.number().finite();
const Conf = z.number().min(0).max(1).optional();
const Scored = <T extends z.ZodType>(t: T) => z.union([t, z.object({ value: t, confidence: Conf })]);

/** What a provider returns (decimal amounts as printed). Validated before any use (RF-50). */
export const RawReceiptDraft = z.object({
  merchant: Scored(z.string().max(200)).optional(),
  transactionDate: Scored(z.string().max(20)).optional(),
  detectedCurrency: z.string().max(10).optional(),
  items: z
    .array(
      z.object({
        description: z.string().max(200).default(''),
        quantity: Num.optional(),
        unitPrice: Num.optional(),
        total: Num.optional(),
        confidence: Conf,
      }),
    )
    .max(300),
  subtotal: Num.optional(),
  tax: Num.optional(),
  tip: Num.optional(),
  discount: Num.optional(),
  total: Scored(Num).optional(),
});
export type RawReceiptDraft = z.infer<typeof RawReceiptDraft>;

export const DraftWarning = z.enum(['CURRENCY_MISMATCH', 'TOTAL_MISMATCH', 'LOW_CONFIDENCE', 'DATE_SUSPICIOUS', 'DUPLICATE_PAGE', 'EMPTY']);
export type DraftWarning = z.infer<typeof DraftWarning>;

export interface ReceiptDraft {
  merchant?: string;
  transactionDate: string;
  detectedCurrency?: string;
  items: { description: string; quantity: number; unitPriceMinor?: number; totalMinor: number }[];
  subtotalMinor?: number;
  taxMinor: number;
  tipMinor: number;
  discountMinor: number;
  totalMinor?: number;
  /** Field keys with low confidence: merchant, transactionDate, total, items.N */
  lowConfidence: string[];
  warnings: DraftWarning[];
}

const valueOf = <T>(s: T | { value: T; confidence?: number | undefined } | undefined): T | undefined =>
  s !== null && typeof s === 'object' && 'value' in (s as object) ? (s as { value: T }).value : (s as T | undefined);
const confOf = (s: unknown): number | undefined =>
  s !== null && typeof s === 'object' && 'confidence' in (s as object) ? (s as { confidence?: number }).confidence : undefined;

/**
 * Converts a printed decimal amount to integer minor units using string arithmetic (half-up),
 * so no binary floating-point error reaches the books (Constitution I).
 */
/** Plain decimal notation (no exponent, no grouping); built once, `toLocaleString` per call is slow. */
const PLAIN = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 20 });

export function decimalToMinor(value: number, decimals: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const [int = '0', frac = ''] = PLAIN.format(value).split('.');
  const padded = (frac + '0'.repeat(decimals + 1)).slice(0, decimals + 1);
  let digits = BigInt(int + padded.slice(0, decimals));
  if (Number(padded[decimals] ?? '0') >= 5) digits += 1n;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes a provider draft for the trip currency; never trusted without the user's review. */
export function normalizeDraft(raw: RawReceiptDraft, opts: { currency: string; today: string }): ReceiptDraft {
  const decimals = currencyDecimals(opts.currency) ?? 2;
  const minor = (v: number | undefined) => (v === undefined ? undefined : (decimalToMinor(v, decimals) ?? undefined));
  const lowConfidence: string[] = [];
  const warnings = new Set<DraftWarning>();

  const items: ReceiptDraft['items'] = [];
  raw.items.forEach((it) => {
    const totalMinor = minor(it.total ?? (it.unitPrice !== undefined ? it.unitPrice * (it.quantity ?? 1) : undefined));
    if (totalMinor === undefined || totalMinor <= 0) {
      warnings.add('LOW_CONFIDENCE');
      return;
    }
    const quantity = Math.max(1, Math.round(it.quantity ?? 1));
    const unitPriceMinor = minor(it.unitPrice);
    if ((it.confidence ?? 1) < LOW_CONFIDENCE) lowConfidence.push(`items.${items.length}`);
    items.push({ description: it.description.trim() || `Ítem ${items.length + 1}`, quantity, ...(unitPriceMinor !== undefined ? { unitPriceMinor } : {}), totalMinor });
  });

  let transactionDate = valueOf(raw.transactionDate);
  const validDate = transactionDate && ISO.test(transactionDate) && !Number.isNaN(Date.parse(`${transactionDate}T00:00:00Z`));
  if (!validDate || transactionDate! > opts.today) {
    if (transactionDate) warnings.add('DATE_SUSPICIOUS');
    transactionDate = opts.today;
    lowConfidence.push('transactionDate');
  } else if ((confOf(raw.transactionDate) ?? 1) < LOW_CONFIDENCE) lowConfidence.push('transactionDate');

  const merchant = valueOf(raw.merchant)?.trim();
  if (merchant && (confOf(raw.merchant) ?? 1) < LOW_CONFIDENCE) lowConfidence.push('merchant');
  const totalMinor = minor(valueOf(raw.total));
  if (totalMinor !== undefined && (confOf(raw.total) ?? 1) < LOW_CONFIDENCE) lowConfidence.push('total');
  const subtotalMinor = minor(raw.subtotal);

  const draft: ReceiptDraft = {
    ...(merchant ? { merchant } : {}),
    transactionDate: transactionDate!,
    ...(raw.detectedCurrency ? { detectedCurrency: raw.detectedCurrency.toUpperCase() } : {}),
    items,
    ...(subtotalMinor !== undefined ? { subtotalMinor } : {}),
    taxMinor: minor(raw.tax) ?? 0,
    tipMinor: minor(raw.tip) ?? 0,
    discountMinor: minor(raw.discount) ?? 0,
    ...(totalMinor !== undefined ? { totalMinor } : {}),
    lowConfidence,
    warnings: [],
  };
  for (const w of draftWarnings(draft, opts.currency)) warnings.add(w);
  draft.warnings = [...warnings];
  return draft;
}

/** Consistency warnings shown in the form (RF-26, RF-54). */
export function draftWarnings(d: ReceiptDraft, currency: string): DraftWarning[] {
  const out: DraftWarning[] = [];
  if (d.detectedCurrency && d.detectedCurrency !== currency) out.push('CURRENCY_MISMATCH');
  const computed = d.items.reduce((a, i) => a + i.totalMinor, 0) + d.taxMinor + d.tipMinor - d.discountMinor;
  if (d.totalMinor !== undefined && d.items.length > 0 && computed !== d.totalMinor) out.push('TOTAL_MISMATCH');
  if (d.items.length === 0 && d.totalMinor === undefined) out.push('EMPTY');
  if (d.lowConfidence.length > 0) out.push('LOW_CONFIDENCE');
  return out;
}
