import { z } from 'zod';
import { IsoDate, Trip } from '../domain.js';

export const MAX_ITEMS_PER_EXPENSE = 200;

const Minor = z.number().int().refine(Number.isSafeInteger, 'Must be a safe integer');
const Uid = z.string().min(1).max(128);

const Allocation = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('equal') }),
  z.object({ mode: z.literal('fixed'), shares: z.array(z.object({ uid: Uid, amountMinor: Minor })).max(50) }),
  z.object({ mode: z.literal('percent'), shares: z.array(z.object({ uid: Uid, bp: z.number() })).max(50) }),
]);

export const ExpenseItemBody = z.object({
  id: z.string().min(1).max(64),
  index: z.number().int().min(0),
  description: z.string().trim().max(120).optional(),
  grossMinor: Minor,
  discountMinor: Minor.default(0),
  /** Units bought (feature 003, refunds by quantity). The engine ignores it for allocation. */
  quantity: z.number().int().min(1).max(100_000).default(1),
  classification: z.enum(['shared', 'personal']),
  beneficiaries: z.array(Uid).max(50),
  allocation: Allocation,
});

export const AdjustmentBody = z.object({
  kind: z.enum(['discount', 'tax', 'tip']),
  amountMinor: Minor,
  mode: z.enum(['proportional', 'equal', 'manual']),
  manualShares: z.array(z.object({ uid: Uid, amountMinor: Minor })).max(50).optional(),
});

export const ServicePeriod = z
  .object({ startDate: IsoDate, endDate: IsoDate })
  .refine((p) => p.endDate >= p.startDate, { path: ['endDate'], message: 'End before start' });

/** Body of POST /trips/{id}/expenses (v2, feature 002). */
export const CreateExpenseBody = z.object({
  description: z.string().trim().min(1).max(120),
  transactionDate: IsoDate,
  categoryId: z.string().min(1).max(64),
  notes: z.string().trim().max(500).nullish(),
  servicePeriod: ServicePeriod.nullish(),
  confirmDuplicate: z.boolean().optional(),
  totalMinor: Minor,
  payers: z.array(z.object({ uid: Uid, amountMinor: Minor })).min(1).max(50),
  splitMode: z.enum(['total', 'items']),
  items: z.array(ExpenseItemBody).min(1).max(MAX_ITEMS_PER_EXPENSE),
  adjustments: z.array(AdjustmentBody).max(10).default([]),
  /** Feature 004: pending uploads to link as receipts, and the scan the draft came from. */
  attachmentUploadIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(10).optional(),
  scanId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
});
export type CreateExpenseBody = z.input<typeof CreateExpenseBody>;

export const IdempotencyKey = z.uuid({ version: 'v4' });

export const VoidExpenseBody = z.object({
  expectedVersion: z.number().int().min(1),
  expectedLedgerRevision: z.number().int().min(0).optional(),
});

/** PUT /trips/{t}/expenses/{e} (feature 003). */
export const UpdateExpenseBody = CreateExpenseBody.omit({ attachmentUploadIds: true, scanId: true }).extend({
  expectedVersion: z.number().int().min(1),
  expectedLedgerRevision: z.number().int().min(0).optional(),
});
export type UpdateExpenseBody = z.input<typeof UpdateExpenseBody>;

export const RestoreExpenseBody = z.object({
  expectedVersion: z.number().int().min(1),
  expectedLedgerRevision: z.number().int().min(0).optional(),
  confirmDuplicate: z.boolean().optional(),
});

export const ExpenseSummary = z.object({
  id: z.string(),
  seq: z.number().int(),
  totalMinor: z.number().int(),
  status: z.enum(['active', 'voided']),
  version: z.number().int(),
  chargesByMember: z
    .record(z.string(), z.object({ sharedMinor: z.number().int(), personalMinor: z.number().int(), netMinor: z.number().int() }))
    .optional(),
});
export type ExpenseSummary = z.infer<typeof ExpenseSummary>;

export const CreateExpenseResponse = z.object({ expense: ExpenseSummary, trip: Trip });
export type CreateExpenseResponse = z.infer<typeof CreateExpenseResponse>;
