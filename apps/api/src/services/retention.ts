import type { ReceiptStorageProvider } from 'contracts';
import type { Doc, Firestore } from '../firestore/client.js';
import { log } from '../http/log.js';
import { EXPIRY_NOTICE_DAYS } from 'contracts';
import { writeAudit } from './audit.js';
import { notificationsFor, writeNotifications } from './notifications.js';

/** Small batches keep each cron invocation well inside the Workers Free CPU budget. */
export const RETENTION_BATCH = 25;

export interface RetentionResult {
  expired: number;
  purgedRemovals: number;
  cleanedUploads: number;
  failed: number;
  /** Feature 005: receipts that entered the 14-day window and were announced once. */
  expiringNotified: number;
  /** Feature 005: notifications older than 90 days removed. */
  notificationsPurged: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_BATCH = 50;
const NOTIFICATION_PURGE_BATCH = 200;

const parentOf = (path: string) => {
  // trips/{t}/{expenses|settlements}/{id}/attachments/{a}
  const [, tripId, kind, targetId] = path.split('/');
  return { tripId: tripId!, targetPath: path.split('/').slice(0, 4).join('/'), kind: kind!, targetId: targetId! };
};

async function due(db: Firestore, collection: string, status: string, now: Date, limit: number): Promise<Doc[]> {
  return db.query(collection, {
    allDescendants: true,
    where: [
      ['status', '==', status],
      ['expiresAt', '<=', now],
    ],
    orderBy: [['expiresAt', 'asc']],
    limit,
  });
}

async function recordFailure(db: Firestore, path: string) {
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(path);
    if (doc) tx.update(path, { deleteAttempts: ((doc.data['deleteAttempts'] as number) ?? 0) + 1, lastDeleteAttemptAt: new Date() });
  });
}

/**
 * RF-52/FR-021: deletes expired receipts (6 calendar months), purges receipts users removed whose
 * object deletion failed, and cleans pending uploads never linked (24 h, FR-023). Idempotent:
 * every step re-checks the status in a transaction and deleting a missing object succeeds, so a
 * re-run (or two overlapping runs) is a no-op. Financial data and audit events are never touched.
 */
export async function runRetention(db: Firestore, storage: ReceiptStorageProvider, now: Date, batch = RETENTION_BATCH): Promise<RetentionResult> {
  const result: RetentionResult = { expired: 0, purgedRemovals: 0, cleanedUploads: 0, failed: 0, expiringNotified: 0, notificationsPurged: 0 };
  let budget = batch;

  for (const [status, next] of [
    ['active', 'deleted'],
    ['removing', 'removed'],
  ] as const) {
    if (budget <= 0) break;
    const docs = await due(db, 'attachments', status, now, budget);
    budget -= docs.length;
    for (const doc of docs) {
      try {
        await storage.delete(doc.data['storageKey'] as string);
      } catch {
        result.failed++;
        log('warn', 'retention_delete_failed', { path: doc.path });
        await recordFailure(db, doc.path);
        continue;
      }
      const done = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.path);
        if (!fresh || fresh.data['status'] !== status) return false;
        const version = (fresh.data['version'] as number) + 1;
        tx.update(doc.path, { status: next, deletedAt: now, version });
        if (status === 'active') {
          const parent = parentOf(doc.path);
          const target = await tx.get(parent.targetPath);
          if (target) tx.update(parent.targetPath, { attachmentCount: Math.max(0, ((target.data['attachmentCount'] as number) ?? 1) - 1) });
          writeAudit(
            tx,
            {
              tripId: parent.tripId,
              actorUid: 'system:retention',
              action: 'attachment.expire',
              entityType: 'attachment',
              entityId: parent.targetId,
              beforeVersion: version - 1,
              afterVersion: version,
              correlationId: crypto.randomUUID(),
              diff: { attachmentId: doc.id },
            },
            now,
          );
        }
        return true;
      });
      if (done) {
        if (status === 'active') result.expired++;
        else result.purgedRemovals++;
      }
    }
  }

  if (budget > 0) {
    for (const doc of await due(db, 'uploads', 'pending', now, budget)) {
      try {
        await storage.delete(doc.data['storageKey'] as string);
      } catch {
        result.failed++;
        continue;
      }
      const done = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.path);
        if (!fresh || fresh.data['status'] !== 'pending') return false;
        tx.update(doc.path, { status: 'deleted', deletedAt: now, version: ((fresh.data['version'] as number) ?? 1) + 1 });
        return true;
      });
      if (done) result.cleanedUploads++;
    }
  }
  result.expiringNotified = await notifyExpiring(db, now);
  result.notificationsPurged = await purgeNotifications(db, now);
  log('info', 'retention_run', { ...result });
  return result;
}

/**
 * Feature 005 (FR-010): one in-app notice per receipt when it enters the 14-day window, to the
 * people who can see its expense (or the two parties of a payment). `expiringNotifiedAt` makes it
 * idempotent across runs.
 */
async function notifyExpiring(db: Firestore, now: Date): Promise<number> {
  const docs = await db.query('attachments', {
    allDescendants: true,
    where: [
      ['status', '==', 'active'],
      ['expiresAt', '>', now],
      ['expiresAt', '<=', new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS)],
    ],
    orderBy: [['expiresAt', 'asc']],
    limit: EXPIRING_BATCH,
  });
  let count = 0;
  for (const doc of docs.filter((d) => !d.data['expiringNotifiedAt'])) {
    const parent = parentOf(doc.path);
    const sent = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.path);
      if (!fresh || fresh.data['status'] !== 'active' || fresh.data['expiringNotifiedAt']) return false;
      const [trip, target] = await Promise.all([tx.get(`trips/${parent.tripId}`), tx.get(parent.targetPath)]);
      if (!trip || !target) return false;
      const isExpense = parent.kind === 'expenses';
      const recipientUids = isExpense
        ? ((target.data['viewerUids'] as string[]) ?? [])
        : [target.data['fromUid'] as string, target.data['toUid'] as string];
      tx.update(doc.path, { expiringNotifiedAt: now });
      writeNotifications(
        tx,
        notificationsFor({
          kind: 'attachment.expiring',
          trip: { id: parent.tripId, name: trip.data['name'] as string, currency: trip.data['currency'] as string },
          attachmentId: doc.id,
          recipientUids,
          link: isExpense ? `/trips/${parent.tripId}/expenses/${parent.targetId}` : `/trips/${parent.tripId}`,
          label: isExpense ? (target.data['description'] as string) : 'Pago',
          expiresAt: fresh.data['expiresAt'] as Date,
        }),
        now,
      );
      return true;
    });
    if (sent) count++;
  }
  return count;
}

/** Feature 005 (FR-013): notifications are kept 90 days. */
async function purgeNotifications(db: Firestore, now: Date): Promise<number> {
  const docs = await db.query('notifications', {
    allDescendants: true,
    where: [['expiresAt', '<=', now]],
    orderBy: [['expiresAt', 'asc']],
    limit: NOTIFICATION_PURGE_BATCH,
  });
  if (docs.length === 0) return 0;
  await db.runTransaction(async (tx) => {
    for (const d of docs) tx.delete(d.path);
  });
  return docs.length;
}
