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

/** Body of POST /trips/{id}/expenses (service-level only in feature 001). */
export const CreateExpenseBody = z.object({
  description: z.string().trim().min(1).max(120),
  transactionDate: IsoDate,
  totalMinor: Minor,
  payers: z.array(z.object({ uid: Uid, amountMinor: Minor })).min(1).max(50),
  splitMode: z.enum(['total', 'items']),
  items: z.array(ExpenseItemBody).min(1).max(MAX_ITEMS_PER_EXPENSE),
  adjustments: z.array(AdjustmentBody).max(10).default([]),
});
export type CreateExpenseBody = z.input<typeof CreateExpenseBody>;

export const IdempotencyKey = z.uuid({ version: 'v4' });

export const VoidExpenseBody = z.object({ expectedVersion: z.number().int().min(1) });

export const ExpenseSummary = z.object({
  id: z.string(),
  seq: z.number().int(),
  totalMinor: z.number().int(),
  status: z.enum(['active', 'voided']),
  version: z.number().int(),
});
export type ExpenseSummary = z.infer<typeof ExpenseSummary>;

export const CreateExpenseResponse = z.object({ expense: ExpenseSummary, trip: Trip });
export type CreateExpenseResponse = z.infer<typeof CreateExpenseResponse>;
