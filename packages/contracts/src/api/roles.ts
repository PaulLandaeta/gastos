import { z } from 'zod';
import { Member, Trip } from '../domain.js';

/** The creator role is permanent and unique; only admin/member can be assigned (RF-35). */
export const SetRoleBody = z.object({
  expectedVersion: z.number().int().min(1),
  role: z.enum(['admin', 'member']),
});
export type SetRoleBody = z.input<typeof SetRoleBody>;

export const SetRoleResponse = z.object({ trip: Trip, member: Member });
export type SetRoleResponse = z.infer<typeof SetRoleResponse>;
