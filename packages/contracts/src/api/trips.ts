import { z } from 'zod';
import { Currency, Email, IsoDate, Member, Trip } from '../domain.js';

export const MAX_TRIP_MEMBERS = 50;

const TripName = z.string().trim().min(1, 'Requerido').max(80);

export const CreateTripBody = z
  .object({
    name: TripName,
    startDate: IsoDate,
    endDate: IsoDate,
    currency: Currency,
    inviteEmails: z.array(Email).max(MAX_TRIP_MEMBERS - 1).default([]),
  })
  .refine((b) => b.endDate >= b.startDate, { path: ['endDate'], message: 'La fecha de fin es anterior al inicio' });
export type CreateTripBody = z.input<typeof CreateTripBody>;

export const UpdateTripBody = z
  .object({
    expectedVersion: z.number().int().min(1),
    name: TripName.optional(),
    startDate: IsoDate.optional(),
    endDate: IsoDate.optional(),
    currency: Currency.optional(),
    /** Feature 007 (RF-57): debt roast ranking, creator/admin only. */
    spicyMode: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.startDate !== undefined ||
      b.endDate !== undefined ||
      b.currency !== undefined ||
      b.spicyMode !== undefined,
    {
      message: 'Nothing to update',
    },
  );
export type UpdateTripBody = z.input<typeof UpdateTripBody>;

export const TripResponse = z.object({ trip: Trip });
export type TripResponse = z.infer<typeof TripResponse>;

export const TripWithMembersResponse = z.object({ trip: Trip, members: z.array(Member) });
export type TripWithMembersResponse = z.infer<typeof TripWithMembersResponse>;
