import { z } from 'zod';
import { Role, TripStatus } from '../domain.js';

/** Feature 006 (RF-56): label shown instead of a deleted member's name. */
export const deletedMemberLabel = (ordinal: number) => `Participante eliminado ${ordinal}`;

/** Literal word the user types to confirm the account deletion. */
export const DELETE_ACCOUNT_CONFIRMATION = 'BORRAR';

/** Maximum age of the sign-in for the deletion (seconds). */
export const RECENT_LOGIN_SECONDS = 300;

export const DeleteAccountBody = z.object({ confirm: z.literal(DELETE_ACCOUNT_CONFIRMATION) }).strict();
export type DeleteAccountBody = z.infer<typeof DeleteAccountBody>;

export const DeletionPreviewTrip = z.object({
  tripId: z.string(),
  name: z.string(),
  currency: z.string(),
  status: TripStatus,
  role: Role,
  balanceMinor: z.number().int(),
  successor: z.object({ uid: z.string(), displayName: z.string() }).optional(),
  pendingSettlements: z.array(
    z.object({ settlementId: z.string(), direction: z.enum(['outgoing', 'incoming']), amountMinor: z.number().int() }),
  ),
});
export type DeletionPreviewTrip = z.infer<typeof DeletionPreviewTrip>;

export const DeletionPreview = z.object({
  trips: z.array(DeletionPreviewTrip),
  attachmentsToDelete: z.number().int(),
  blocked: z.boolean(),
});
export type DeletionPreview = z.infer<typeof DeletionPreview>;

export const DeleteAccountResponse = z.object({
  status: z.enum(['in_progress', 'completed']),
  tripsProcessed: z.number().int(),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
