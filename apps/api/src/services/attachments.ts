import { DOWNLOAD_URL_TTL_SECONDS, EXPIRY_NOTICE_DAYS, type ReceiptStorageProvider } from 'contracts';
import type { Doc, Firestore, Transaction } from '../firestore/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { log } from '../http/log.js';
import { writeAudit } from './audit.js';
import { expensePath, type ExpenseDoc } from './expenses.js';
import { assertMutable, loadTripForMember, type LoadedTrip, type MutationContext } from './tripRepo.js';
import {
  assertCanAttach,
  attachmentsPath,
  linkUploadsTx,
  targetPath,
  toAttachmentDto,
  verifyUploads,
  type AttachmentData,
  type Target,
} from './uploads.js';
import { canViewExpense, canVoidExpense } from './visibility.js';

const MANAGERS = ['creator', 'admin'];

/**
 * Who may see a target's receipts: the expense's viewers (RF-38) or, for a payment, emitter,
 * receiver and managers (FR-006). Anyone else gets NOT_FOUND (no existence leak).
 */
async function loadVisibleTarget(tx: Transaction, loaded: LoadedTrip, target: Target): Promise<Doc> {
  const doc = await tx.get(targetPath(loaded.trip.id, target));
  const me = loaded.me.data;
  if (target.kind === 'expense') {
    if (!doc || !canViewExpense(me, doc.data as unknown as ExpenseDoc)) throw notFound('Expense');
    return doc;
  }
  if (!doc || !(MANAGERS.includes(me.role) || [doc.data['fromUid'], doc.data['toUid']].includes(me.uid))) {
    throw notFound('Settlement');
  }
  return doc;
}

export async function listAttachments(db: Firestore, tripId: string, target: Target, uid: string) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, uid);
    await loadVisibleTarget(tx, loaded, target);
    const docs = await tx.query(attachmentsPath(tripId, target));
    const attachments = docs
      .map((d) => toAttachmentDto(d.id, d.data as unknown as AttachmentData))
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id));
    return { attachments };
  });
}

/** FR-004: a 15-minute signed link, issued only after the permission check. */
export async function attachmentUrl(
  db: Firestore,
  storage: ReceiptStorageProvider,
  tripId: string,
  target: Target,
  attachmentId: string,
  uid: string,
) {
  const attachment = await db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, uid);
    await loadVisibleTarget(tx, loaded, target);
    const doc = await tx.get(`${attachmentsPath(tripId, target)}/${attachmentId}`);
    const data = doc?.data as unknown as AttachmentData | undefined;
    if (!data || data.status !== 'active') throw notFound('Attachment');
    return data;
  });
  const signed = await storage.presignGet(attachment.storageKey, DOWNLOAD_URL_TTL_SECONDS, attachment.fileName);
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
}

/** Attach verified uploads to an existing expense or payment (FR-001/FR-006). */
export async function attachToTarget(
  db: Firestore,
  storage: ReceiptStorageProvider,
  tripId: string,
  target: Target,
  uploadIds: string[],
  ctx: MutationContext,
) {
  const verified = await verifyUploads(db, storage, tripId, uploadIds, ctx.actorUid, ctx.now);
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    const doc = await assertCanAttach(tx, loaded, target, ctx.actorUid);
    const attachments = await linkUploadsTx(tx, tripId, verified, target, ctx, {
      source: 'manual',
      isNewTarget: false,
      onDuplicate: 'error',
    });
    tx.update(targetPath(tripId, target), { attachmentCount: ((doc.data['attachmentCount'] as number) ?? 0) + attachments.length });
    return { attachments };
  });
}

/**
 * FR-005: author, creator or admin removes a receipt from an active expense. Amounts and the
 * expense version do not change; the removal is audited and the object deleted right away
 * (`removing` stays for the retention job to retry if storage fails).
 */
export async function removeExpenseAttachment(
  db: Firestore,
  storage: ReceiptStorageProvider,
  tripId: string,
  expenseId: string,
  attachmentId: string,
  ctx: MutationContext,
) {
  const path = `${expensePath(tripId, expenseId)}/attachments/${attachmentId}`;
  const removed = await db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    const doc = await tx.get(expensePath(tripId, expenseId));
    const expense = doc?.data as unknown as ExpenseDoc | undefined;
    if (!expense || !canViewExpense(loaded.me.data, expense)) throw notFound('Expense');
    if (!canVoidExpense(loaded.me.data, expense, loaded.trip.data.status)) {
      throw forbidden('Only the author, the creator or an admin can remove a receipt');
    }
    const att = await tx.get(path);
    const data = att?.data as unknown as AttachmentData | undefined;
    if (!data) throw notFound('Attachment');
    if (data.status !== 'active') throw new AppError('INVALID_TRANSITION', 'The receipt was already removed');
    tx.update(path, { status: 'removing', removedBy: ctx.actorUid, removedAt: ctx.now, expiresAt: ctx.now, version: data.version + 1 });
    tx.update(expensePath(tripId, expenseId), {
      attachmentCount: Math.max(0, ((doc!.data['attachmentCount'] as number) ?? 1) - 1),
    });
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'attachment.remove',
        entityType: 'attachment',
        entityId: expenseId,
        beforeVersion: data.version,
        afterVersion: data.version + 1,
        correlationId: ctx.correlationId,
        diff: { attachmentId },
      },
      ctx.now,
    );
    return { ...data, status: 'removing' as const, version: data.version + 1 };
  });
  try {
    await storage.delete(removed.storageKey);
    await db.runTransaction(async (tx) => {
      tx.update(path, { status: 'removed', deletedAt: new Date(), version: removed.version + 1 });
    });
    return { attachment: toAttachmentDto(attachmentId, { ...removed, status: 'removed', deletedAt: new Date() }) };
  } catch {
    log('warn', 'attachment_delete_deferred', { tripId, attachmentId });
    return { attachment: toAttachmentDto(attachmentId, removed) };
  }
}

/**
 * FR-022: receipts of the trip that expire within 14 days, only those the caller can see (expense
 * viewers; payment emitter, receiver and managers). Never reveals receipts of hidden expenses.
 */
export async function expiringAttachments(db: Firestore, tripId: string, uid: string, now: Date) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, uid);
    const limit = new Date(now.getTime() + EXPIRY_NOTICE_DAYS * 86_400_000);
    const docs = await tx.query('attachments', {
      allDescendants: true,
      where: [
        ['tripId', '==', tripId],
        ['status', '==', 'active'],
        ['expiresAt', '<=', limit],
      ],
    });
    const parents = await tx.getAll([...new Set(docs.map((d) => d.path.split('/').slice(0, 4).join('/')))]);
    const me = loaded.me.data;
    const out = [];
    for (const d of docs) {
      const [, , kind, targetId] = d.path.split('/');
      const parent = parents.get(d.path.split('/').slice(0, 4).join('/'));
      if (!parent) continue;
      const visible =
        kind === 'expenses'
          ? canViewExpense(me, parent.data as unknown as ExpenseDoc)
          : MANAGERS.includes(me.role) || [parent.data['fromUid'], parent.data['toUid']].includes(me.uid);
      if (!visible) continue;
      const a = d.data as unknown as AttachmentData;
      out.push({
        id: d.id,
        fileName: a.fileName,
        expiresAt: a.expiresAt.toISOString(),
        target: kind === 'expenses' ? { expenseId: targetId! } : { settlementId: targetId! },
        label: kind === 'expenses' ? ((parent.data['description'] as string) ?? 'Gasto') : 'Pago',
      });
    }
    return { attachments: out.sort((x, y) => x.expiresAt.localeCompare(y.expiresAt)) };
  });
}
