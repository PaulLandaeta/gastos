import { z } from 'zod';

/** Feature 005 (RF-19): trip export. The API returns privacy-filtered pages; the browser builds the file. */
/** Measured: ~3.5 ms of CPU per page of 100 heavy expenses (perf/export.perf.ts), 50 % headroom. */
export const EXPORT_PAGE_SIZE = 100;

export const ExportFormat = z.enum(['xlsx', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportQuery = z.object({
  format: ExportFormat,
  cursor: z.string().min(1).max(512).optional(),
});

const Minor = z.number().int();
const Share = z.object({ uid: z.string(), amountMinor: Minor });

export const ExportExpense = z.object({
  id: z.string(),
  seq: z.number().int(),
  transactionDate: z.string(),
  createdAt: z.string(),
  description: z.string(),
  categoryId: z.string(),
  totalMinor: Minor,
  sharedMinor: Minor,
  personalMinor: Minor,
  status: z.enum(['active', 'voided']),
  source: z.enum(['manual', 'ai']),
  payers: z.array(Share),
  /** Net charge per beneficiary (shared + personal + adjustments). */
  allocations: z.array(Share),
  items: z.array(
    z.object({
      description: z.string().nullable(),
      quantity: z.number().int(),
      grossMinor: Minor,
      discountMinor: Minor,
      classification: z.enum(['shared', 'personal']),
      beneficiaries: z.array(z.string()),
    }),
  ),
  adjustments: z.array(z.object({ kind: z.string(), amountMinor: Minor })),
});
export type ExportExpense = z.infer<typeof ExportExpense>;

export const TripExportHeader = z.object({
  trip: z.object({
    id: z.string(),
    name: z.string(),
    currency: z.string(),
    status: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  generatedAt: z.string(),
  generatedBy: z.object({ uid: z.string(), displayName: z.string() }),
  /** `all`: creator/admin export every expense; `visible`: only the expenses the participant can see. */
  scope: z.enum(['all', 'visible']),
  /** Upper bound for the progress indicator (expenses ever registered in the trip). */
  registeredCount: z.number().int(),
  members: z.array(z.object({ uid: z.string(), displayName: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  settlements: z.array(
    z.object({
      id: z.string(),
      fromUid: z.string(),
      toUid: z.string(),
      amountMinor: Minor,
      status: z.string(),
      createdAt: z.string().nullable(),
      resolvedAt: z.string().nullable(),
    }),
  ),
  /**
   * Net balance of everyone is public (RF-39). What others paid and consumed is only for managers
   * (FR-026): `null` for the other participants in a participant's export.
   */
  balances: z.array(
    z.object({ uid: z.string(), paidMinor: Minor.nullable(), consumedMinor: Minor.nullable(), netMinor: Minor }),
  ),
  debts: z.object({
    original: z.array(z.object({ fromUid: z.string(), toUid: z.string(), amountMinor: Minor })),
    simplified: z.array(z.object({ fromUid: z.string(), toUid: z.string(), amountMinor: Minor })),
  }),
  totals: z.object({
    sharedMinor: Minor,
    personalMinor: Minor,
    byCategory: z.array(z.object({ categoryId: z.string(), name: z.string(), totalMinor: Minor })),
  }),
});
export type TripExportHeader = z.infer<typeof TripExportHeader>;

export const ExportRefund = z.object({
  id: z.string(),
  expenseId: z.string(),
  itemId: z.string(),
  quantity: z.number().int(),
  amountMinor: Minor,
  recipientUid: z.string(),
  createdAt: z.string().nullable(),
});
export type ExportRefund = z.infer<typeof ExportRefund>;

export const TripExportPage = z.object({
  header: TripExportHeader.optional(),
  expenses: z.array(ExportExpense),
  voidedExpenses: z.array(ExportExpense),
  /** Refunds of the expenses in this page. */
  refunds: z.array(ExportRefund),
  nextCursor: z.string().nullable(),
});
export type TripExportPage = z.infer<typeof TripExportPage>;

/** Full export composed by the client from every page. */
export type TripExport = TripExportHeader & {
  expenses: ExportExpense[];
  voidedExpenses: ExportExpense[];
  refunds: ExportRefund[];
};
