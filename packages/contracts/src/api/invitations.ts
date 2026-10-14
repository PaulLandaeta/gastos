import { z } from 'zod';
import { Email, Member, Trip } from '../domain.js';

export const InviteBody = z.object({
  expectedVersion: z.number().int().min(1),
  emails: z.array(Email).min(1).max(20),
});
export type InviteBody = z.input<typeof InviteBody>;

export const ExpectedVersionQuery = z.object({ expectedVersion: z.coerce.number().int().min(1) });

export const AcceptInvitationResponse = z.object({ trip: Trip, member: Member });
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponse>;
