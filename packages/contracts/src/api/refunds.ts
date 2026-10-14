import { z } from 'zod';

const Minor = z.number().int().refine(Number.isSafeInteger, 'Must be a safe integer');

export const CreateRefundBody = z.object({
  itemId: z.string().min(1).max(64),
  /** Units returned (0 when refunding by amount only). */
  quantity: z.number().int().min(0).max(100_000),
  amountMinor: Minor.refine((v) => v > 0, 'Must be positive'),
  recipientUid: z.string().min(1).max(128),
});
export type CreateRefundBody = z.input<typeof CreateRefundBody>;

export const RefundableQuery = z.object({ quantity: z.coerce.number().int().min(0).max(100_000).default(1) });

export const RefundableResponse = z.object({
  quantity: z.number().int(),
  refundedQuantity: z.number().int(),
  maxMinor: z.number().int(),
  refundedMinor: z.number().int(),
  suggestedMinor: z.number().int(),
});
export type RefundableResponse = z.infer<typeof RefundableResponse>;

export const RefundDto = z.object({
  id: z.string(),
  itemId: z.string(),
  quantity: z.number().int(),
  amountMinor: z.number().int(),
  recipientUid: z.string(),
  chargesDelta: z.record(z.string(), z.number().int()),
  createdBy: z.string(),
});
export type RefundDto = z.infer<typeof RefundDto>;
