import { z } from 'zod';

const Int = z.number().int();

export const MemberStatsDto = z.object({
  contributedMinor: Int,
  sharedConsumedMinor: Int,
  personalConsumedMinor: Int,
  globalConsumedMinor: Int,
});

export const StatsResponse = z.object({
  currency: z.string(),
  sharedTotalMinor: Int,
  expenseCount: Int,
  me: MemberStatsDto.extend({ balanceMinor: Int }),
  /** Trip-wide for creator/admin; only the expenses the user can see otherwise (spec Q3). */
  byCategory: z.record(z.string(), Int),
  /** Only for creator/admin (FR-026). */
  members: z.array(MemberStatsDto.extend({ uid: z.string() })).optional(),
});
export type StatsResponse = z.infer<typeof StatsResponse>;
