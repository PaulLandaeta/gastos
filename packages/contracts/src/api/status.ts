import { z } from 'zod';

export const TripStatusAction = z.enum(['close', 'reopen', 'archive', 'restore']);
export type TripStatusAction = z.infer<typeof TripStatusAction>;

export const TripStatusBody = z.object({
  expectedVersion: z.number().int().min(1),
  action: TripStatusAction,
});
export type TripStatusBody = z.input<typeof TripStatusBody>;
