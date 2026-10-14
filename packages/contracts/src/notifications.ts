import { z } from 'zod';

/** In-app notification types (feature 005, RF-18). No push or e-mail. */
export const NOTIFICATION_TYPES = [
  'expense.created',
  'expense.updated',
  'expense.removed_from',
  'expense.voided',
  'expense.restored',
  'settlement.pending',
  'settlement.confirmed',
  'settlement.rejected',
  'refund.received',
  'attachment.expiring',
  'trip.status_changed',
  'invitation.received',
] as const;
export const NotificationType = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationType>;

export const NOTIFICATION_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
export const notificationExpiry = (createdAt: Date) => new Date(createdAt.getTime() + NOTIFICATION_RETENTION_DAYS * DAY_MS);

export const NotificationEntity = z.object({
  kind: z.enum(['expense', 'settlement', 'refund', 'attachment', 'trip', 'invitation']),
  id: z.string(),
});

export const Notification = z.object({
  id: z.string(),
  type: NotificationType,
  tripId: z.string(),
  tripName: z.string(),
  entity: NotificationEntity,
  title: z.string(),
  /** Description and amount only when the recipient can see the expense (RF-38). */
  body: z.string().nullable(),
  link: z.string(),
  actorUid: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  expiresAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;

const NotificationIds = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(100);

/** POST /me/notifications/read */
export const NotificationsReadBody = z.union([
  z.object({ ids: NotificationIds }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type NotificationsReadBody = z.infer<typeof NotificationsReadBody>;

/** POST /me/notifications/unread */
export const NotificationsUnreadBody = z.object({ ids: NotificationIds }).strict();
export type NotificationsUnreadBody = z.infer<typeof NotificationsUnreadBody>;

export const NotificationsUpdateResponse = z.object({ updated: z.number().int() });
