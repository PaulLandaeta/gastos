import { z } from 'zod';

const Minor = z.number().int().refine(Number.isSafeInteger, 'Must be a safe integer');

export const SettlementStatus = z.enum(['pending', 'confirmed', 'rejected', 'cancelled']);
export type SettlementStatus = z.infer<typeof SettlementStatus>;

export const CreateSettlementBody = z.object({
  toUid: z.string().min(1).max(128),
  amountMinor: Minor.refine((v) => v > 0, 'Must be positive'),
  note: z.string().trim().max(200).optional(),
});
export type CreateSettlementBody = z.input<typeof CreateSettlementBody>;

export const ResolveSettlementBody = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(200).optional(),
});

export const SettlementDto = z.object({
  id: z.string(),
  fromUid: z.string(),
  toUid: z.string(),
  amountMinor: z.number().int(),
  note: z.string().nullable(),
  status: SettlementStatus,
  rejectionReason: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  version: z.number().int(),
});
export type SettlementDto = z.infer<typeof SettlementDto>;
