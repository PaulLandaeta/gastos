import { z } from 'zod';
import { CreateExpenseBody } from './expenses.js';

export const PreviewBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), body: CreateExpenseBody }),
  z.object({ action: z.literal('void') }),
  z.object({ action: z.literal('restore') }),
]);
export type PreviewBody = z.input<typeof PreviewBody>;

const Row = z.object({ uid: z.string(), netMinor: z.number().int() });

export const PreviewResponse = z.object({
  before: z.array(Row),
  after: z.array(Row),
  delta: z.array(Row),
  ledgerRevision: z.number().int(),
  requiresConfirmation: z.boolean(),
});
export type PreviewResponse = z.infer<typeof PreviewResponse>;
