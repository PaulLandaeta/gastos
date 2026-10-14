import { notificationExpiry, SCHEMA_VERSION, type NotificationType } from 'contracts';
import { minorUnits } from 'finance-engine';
import type { Firestore, Transaction } from '../firestore/client.js';
import { newId } from './tripRepo.js';

/**
 * In-app notifications (feature 005, RF-18). `notificationsFor` is pure: it decides recipients and
 * text with the visibility rules (RF-38). Expense details only go to people who take part in the
 * expense (payers and beneficiaries), who are exactly the ones who can see it; the author is never
 * notified of their own action. Written in the same transaction as the action that causes them.
 */
export interface TripRef {
  id: string;
  name: string;
  currency: string;
}

export interface Actor {
  uid: string;
  name: string;
}

export interface ExpenseSnap {
  description: string;
  totalMinor: number;
  payers: { uid: string; amountMinor: number }[];
  chargesByMember: Record<string, { netMinor: number }>;
}

export type NotificationEvent =
  | { kind: 'expense.created' | 'expense.voided' | 'expense.restored'; trip: TripRef; actor: Actor; expenseId: string; expense: ExpenseSnap }
  | { kind: 'expense.updated'; trip: TripRef; actor: Actor; expenseId: string; before: ExpenseSnap; after: ExpenseSnap }
  | {
      kind: 'settlement.pending' | 'settlement.confirmed' | 'settlement.rejected';
      trip: TripRef;
      actor: Actor;
      settlementId: string;
      fromUid: string;
      toUid: string;
      amountMinor: number;
    }
  | {
      kind: 'refund.received';
      trip: TripRef;
      actor: Actor;
      expenseId: string;
      recipientUid: string;
      amountMinor: number;
      expenseDescription: string;
      recipientCanView: boolean;
    }
  | {
      kind: 'attachment.expiring';
      trip: TripRef;
      attachmentId: string;
      recipientUids: string[];
      link: string;
      label: string;
      expiresAt: Date;
    }
  | { kind: 'trip.status_changed'; trip: TripRef; actor: Actor; status: string; memberUids: string[] }
  | { kind: 'invitation.received'; trip: TripRef; actor: Actor; inviteeUids: string[] };

export interface NotificationDraft {
  recipientUid: string;
  type: NotificationType;
  tripId: string;
  tripName: string;
  entity: { kind: 'expense' | 'settlement' | 'refund' | 'attachment' | 'trip' | 'invitation'; id: string };
  title: string;
  body: string | null;
  link: string;
  actorUid: string;
}

/** Display amount built from integers (no floating point), e.g. `12.50 USD`. */
export function formatMinor(amountMinor: number, currency: string): string {
  const d = minorUnits(currency);
  const sign = amountMinor < 0 ? '-' : '';
  const digits = String(Math.abs(amountMinor)).padStart(d + 1, '0');
  const value = d === 0 ? digits : `${digits.slice(0, -d)}.${digits.slice(-d)}`;
  return `${sign}${value} ${currency}`;
}

const participants = (e: ExpenseSnap) => new Set([...e.payers.map((p) => p.uid), ...Object.keys(e.chargesByMember)]);
const paidBy = (e: ExpenseSnap, uid: string) => e.payers.filter((p) => p.uid === uid).reduce((a, p) => a + p.amountMinor, 0);
const consumedBy = (e: ExpenseSnap, uid: string) => e.chargesByMember[uid]?.netMinor ?? 0;

function expenseBody(trip: TripRef, e: ExpenseSnap, uid: string): string {
  const share = consumedBy(e, uid);
  const parts = [e.description, formatMinor(e.totalMinor, trip.currency)];
  if (share > 0) parts.push(`tu parte ${formatMinor(share, trip.currency)}`);
  return parts.join(' · ');
}

const STATUS_VERB: Record<string, string> = {
  closed: 'cerró',
  active: 'reabrió',
  archived: 'archivó',
};

export function notificationsFor(event: NotificationEvent): NotificationDraft[] {
  const { trip } = event;
  const base = (recipientUid: string, type: NotificationType, actorUid: string) => ({
    recipientUid,
    type,
    tripId: trip.id,
    tripName: trip.name,
    actorUid,
  });

  switch (event.kind) {
    case 'expense.created':
    case 'expense.voided':
    case 'expense.restored': {
      const verb = { 'expense.created': 'registró', 'expense.voided': 'anuló', 'expense.restored': 'restauró' }[event.kind];
      return [...participants(event.expense)]
        .filter((uid) => uid !== event.actor.uid)
        .map((uid) => ({
          ...base(uid, event.kind, event.actor.uid),
          entity: { kind: 'expense', id: event.expenseId },
          title: `${event.actor.name} ${verb} un gasto en ${trip.name}`,
          body: expenseBody(trip, event.expense, uid),
          link: `/trips/${trip.id}/expenses/${event.expenseId}`,
        }));
    }
    case 'expense.updated': {
      const before = participants(event.before);
      const after = participants(event.after);
      const out: NotificationDraft[] = [];
      for (const uid of after) {
        if (uid === event.actor.uid) continue;
        const changed =
          !before.has(uid) ||
          paidBy(event.before, uid) !== paidBy(event.after, uid) ||
          consumedBy(event.before, uid) !== consumedBy(event.after, uid);
        if (!changed) continue;
        out.push({
          ...base(uid, 'expense.updated', event.actor.uid),
          entity: { kind: 'expense', id: event.expenseId },
          title: `${event.actor.name} cambió tu parte en un gasto de ${trip.name}`,
          body: expenseBody(trip, event.after, uid),
          link: `/trips/${trip.id}/expenses/${event.expenseId}`,
        });
      }
      for (const uid of before) {
        if (after.has(uid) || uid === event.actor.uid) continue;
        // Removed: they can no longer see the expense, so nothing about it is revealed.
        out.push({
          ...base(uid, 'expense.removed_from', event.actor.uid),
          entity: { kind: 'expense', id: event.expenseId },
          title: `Ya no participas en un gasto de ${trip.name}`,
          body: null,
          link: `/trips/${trip.id}/expenses`,
        });
      }
      return out;
    }
    case 'settlement.pending':
    case 'settlement.confirmed':
    case 'settlement.rejected': {
      const recipient = event.kind === 'settlement.pending' ? event.toUid : event.fromUid;
      if (recipient === event.actor.uid) return [];
      const title =
        event.kind === 'settlement.pending'
          ? `${event.actor.name} te registró un pago por confirmar`
          : `${event.actor.name} ${event.kind === 'settlement.confirmed' ? 'confirmó' : 'rechazó'} tu pago`;
      return [
        {
          ...base(recipient, event.kind, event.actor.uid),
          entity: { kind: 'settlement', id: event.settlementId },
          title,
          body: formatMinor(event.amountMinor, trip.currency),
          link: `/trips/${trip.id}`,
        },
      ];
    }
    case 'refund.received': {
      if (event.recipientUid === event.actor.uid) return [];
      const amount = formatMinor(event.amountMinor, trip.currency);
      return [
        {
          ...base(event.recipientUid, 'refund.received', event.actor.uid),
          entity: { kind: 'expense', id: event.expenseId },
          title: `${event.actor.name} registró una devolución para ti en ${trip.name}`,
          body: event.recipientCanView ? `${event.expenseDescription} · ${amount}` : amount,
          link: event.recipientCanView ? `/trips/${trip.id}/expenses/${event.expenseId}` : `/trips/${trip.id}`,
        },
      ];
    }
    case 'attachment.expiring':
      return [...new Set(event.recipientUids)].map((uid) => ({
        ...base(uid, 'attachment.expiring', 'system'),
        entity: { kind: 'attachment', id: event.attachmentId },
        title: `Un comprobante de ${trip.name} se eliminará pronto`,
        body: `${event.label} · se elimina el ${event.expiresAt.toISOString().slice(0, 10)}`,
        link: event.link,
      }));
    case 'trip.status_changed':
      return event.memberUids
        .filter((uid) => uid !== event.actor.uid)
        .map((uid) => ({
          ...base(uid, 'trip.status_changed', event.actor.uid),
          entity: { kind: 'trip', id: trip.id },
          title: `${event.actor.name} ${STATUS_VERB[event.status] ?? 'cambió el estado de'} el viaje ${trip.name}`,
          body: null,
          link: `/trips/${trip.id}`,
        }));
    case 'invitation.received':
      return event.inviteeUids
        .filter((uid) => uid !== event.actor.uid)
        .map((uid) => ({
          ...base(uid, 'invitation.received', event.actor.uid),
          entity: { kind: 'invitation', id: trip.id },
          title: `${event.actor.name} te invitó al viaje ${trip.name}`,
          body: null,
          link: '/',
        }));
  }
}

export const notificationPath = (uid: string, id: string) => `users/${uid}/notifications/${id}`;

/**
 * Buffers the notifications in the caller's transaction (they exist only if the action commits).
 * Feature 006: members who deleted their account (RF-56) never receive notifications.
 */
export function writeNotifications(
  tx: Transaction,
  drafts: NotificationDraft[],
  now: Date,
  members: { data: { uid: string | null; deletedAt?: unknown } }[] = [],
): void {
  const deleted = new Set(members.filter((m) => m.data.deletedAt != null && m.data.uid).map((m) => m.data.uid!));
  for (const { recipientUid, ...n } of drafts) {
    if (deleted.has(recipientUid)) continue;
    tx.set(
      notificationPath(recipientUid, newId()),
      { ...n, createdAt: now, readAt: null, expiresAt: notificationExpiry(now), schemaVersion: SCHEMA_VERSION },
      { exists: false },
    );
  }
}

/** Invitees who already have an account (by verified, normalized e-mail) get an in-app notice. */
export async function registeredUidsByEmail(tx: Transaction, emails: string[]): Promise<string[]> {
  const uids: string[] = [];
  for (let i = 0; i < emails.length; i += 30) {
    const docs = await tx.query('users', { where: [['email', 'in', emails.slice(i, i + 30)]] });
    uids.push(...docs.map((d) => d.id));
  }
  return uids;
}

/** Display name of a member for notification titles (never the e-mail). */
export function actorName(members: { data: { uid: string | null; displayName: string | null } }[], uid: string): string {
  return members.find((m) => m.data.uid === uid)?.data.displayName ?? 'Alguien';
}

const MAX_MARK = 400;

/** POST /me/notifications/read|unread: only the caller's own notifications change. */
export async function markNotifications(
  db: Firestore,
  uid: string,
  target: { ids: string[] } | { all: true },
  read: boolean,
  now: Date,
): Promise<{ updated: number }> {
  return db.runTransaction(async (tx) => {
    let paths: string[];
    if ('all' in target) {
      const unread = await tx.query(`users/${uid}/notifications`, { where: [['readAt', '==', null]], limit: MAX_MARK });
      paths = unread.map((d) => d.path);
    } else {
      const docs = await tx.getAll(target.ids.map((id) => notificationPath(uid, id)));
      paths = [...docs.values()].filter((d): d is NonNullable<typeof d> => d !== null).map((d) => d.path);
    }
    for (const p of paths) tx.update(p, { readAt: read ? now : null });
    return { updated: paths.length };
  });
}
