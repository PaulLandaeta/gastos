import { z } from 'zod';

export const BalancesQuery = z.object({ view: z.enum(['original', 'simplified']).default('simplified') });

export const BalancesResponse = z.object({
  currency: z.string(),
  view: z.enum(['original', 'simplified']),
  netByMember: z.array(z.object({ uid: z.string(), netMinor: z.number().int() })),
  transfers: z.array(z.object({ fromUid: z.string(), toUid: z.string(), amountMinor: z.number().int() })),
  sourceRevision: z.number().int(),
});
export type BalancesResponse = z.infer<typeof BalancesResponse>;
