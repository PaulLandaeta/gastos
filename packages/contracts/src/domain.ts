import { z } from 'zod';
import { isCurrency } from './currencies.js';

export const SCHEMA_VERSION = 1;

export const TripStatus = z.enum(['pending', 'active', 'closed', 'archived']);
export type TripStatus = z.infer<typeof TripStatus>;

export const Role = z.enum(['creator', 'admin', 'member']);
export type Role = z.infer<typeof Role>;

export const InvitationStatus = z.enum(['invited', 'accepted', 'declined']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

/** Canonical e-mail form used for invitations and Security Rules (`token.email.lower()`). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const Email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform(normalizeEmail);

/** Calendar date `YYYY-MM-DD` that exists in the Gregorian calendar. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Invalid calendar date');

export const Currency = z.string().refine(isCurrency, 'Unknown ISO 4217 currency');

const Versioned = {
  schemaVersion: z.number().int(),
  version: z.number().int().min(1),
};

const Timestamp = z.union([z.date(), z.string()]);

export const UserProfile = z.object({
  uid: z.string(),
  displayName: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  photoURL: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  ...Versioned,
});
export type UserProfile = z.infer<typeof UserProfile>;

export const Trip = z.object({
  id: z.string(),
  name: z.string(),
  startDate: IsoDate,
  endDate: IsoDate,
  currency: z.string(),
  status: TripStatus,
  previousStatus: TripStatus.nullable(),
  creatorUid: z.string(),
  participantsLocked: z.boolean(),
  currencyLocked: z.boolean(),
  firstExpenseAt: Timestamp.nullable(),
  expenseSeq: z.number().int().min(0),
  memberCount: z.number().int(),
  pendingInvitationCount: z.number().int(),
  declinedInvitationCount: z.number().int(),
  confirmedSettlementCount: z.number().int().optional(),
  /** Feature 006: numbers the «Participante eliminado N» labels. */
  deletedMemberCount: z.number().int().optional(),
  /** Feature 007 (RF-57): debt roast ranking; absent means off. */
  spicyMode: z.boolean().optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  ...Versioned,
});
export type Trip = z.infer<typeof Trip>;

export const Member = z.object({
  key: z.string(),
  uid: z.string().nullable(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: Role,
  invitationStatus: InvitationStatus,
  invitedAt: Timestamp.nullable(),
  acceptedAt: Timestamp.nullable(),
  joinOrder: z.number().int().nullable(),
  /** Feature 006 (RF-56): set when the member deleted their account; the uid stays as an opaque id. */
  deletedAt: Timestamp.nullable().optional(),
  deletedOrdinal: z.number().int().nullable().optional(),
  ...Versioned,
});
export type Member = z.infer<typeof Member>;

export const UserTripIndex = z.object({
  tripId: z.string(),
  name: z.string(),
  startDate: IsoDate,
  endDate: IsoDate,
  currency: z.string(),
  status: TripStatus,
  role: Role,
  updatedAt: Timestamp,
  ...Versioned,
});
export type UserTripIndex = z.infer<typeof UserTripIndex>;

export const InvitationIndex = z.object({
  tripId: z.string(),
  tripName: z.string(),
  inviterDisplayName: z.string(),
  startDate: IsoDate,
  endDate: IsoDate,
  currency: z.string(),
  status: z.enum(['invited', 'declined']),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  ...Versioned,
});
export type InvitationIndex = z.infer<typeof InvitationIndex>;
