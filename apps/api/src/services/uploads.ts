import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TARGET,
  MAX_PDF_PAGES,
  PENDING_UPLOAD_TTL_MS,
  attachmentExpiry,
  type Attachment,
  type CreateUploadsBody,
  type UploadTarget,
  type ReceiptStorageProvider,
  type UploadFileInput,
} from 'contracts';
import type { z } from 'zod';
import type { Doc, Firestore, Transaction } from '../firestore/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { log } from '../http/log.js';
import { writeAudit } from './audit.js';
import { expensePath, type ExpenseDoc } from './expenses.js';
import { assertMutable, loadTripForMember, newId, type LoadedTrip, type MutationContext } from './tripRepo.js';
import { canViewExpense } from './visibility.js';

export const UPLOAD_SCHEMA_VERSION = 1;
export const ATTACHMENT_SCHEMA_VERSION = 1;

export const uploadPath = (tripId: string, id: string) => `trips/${tripId}/uploads/${id}`;
export const settlementPath = (tripId: string, id: string) => `trips/${tripId}/settlements/${id}`;

export type Target = { kind: 'expense'; id: string } | { kind: 'settlement'; id: string };

export const targetPath = (tripId: string, t: Target) =>
  t.kind === 'expense' ? expensePath(tripId, t.id) : settlementPath(tripId, t.id);
export const attachmentsPath = (tripId: string, t: Target) => `${targetPath(tripId, t)}/attachments`;

export interface UploadData {
  storageKey: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  pages: number;
  sha256: string;
  uploadedBy: string;
  status: 'pending' | 'linked' | 'deleted';
  target: Target | null;
  createdAt: Date;
  expiresAt: Date;
  version: number;
}

export interface AttachmentData {
  tripId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  pages: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: Date;
  expiresAt: Date;
  status: Attachment['status'];
  source: 'manual' | 'scan';
  deletedAt: Date | null;
  deleteAttempts: number;
  version: number;
}

export const toAttachmentDto = (id: string, a: AttachmentData): Attachment => ({
  id,
  fileName: a.fileName,
  mimeType: a.mimeType,
  bytes: a.bytes,
  pages: a.pages,
  sha256: a.sha256,
  uploadedBy: a.uploadedBy,
  uploadedAt: a.uploadedAt.toISOString(),
  expiresAt: a.expiresAt.toISOString(),
  status: a.status,
  source: a.source,
  deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
});

const invalid = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError('ATTACHMENT_INVALID', 'The file is not an accepted receipt', { reason, ...details });

/** FR-002: type, size and pages are checked before anything is stored. */
export function validateFile(f: UploadFileInput, index: number): void {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(f.mimeType)) throw invalid('TYPE', { index });
  if (f.bytes < 1 || f.bytes > MAX_ATTACHMENT_BYTES) throw invalid('SIZE', { index, maxBytes: MAX_ATTACHMENT_BYTES });
  const maxPages = f.mimeType === 'application/pdf' ? MAX_PDF_PAGES : 1;
  if (f.pages < 1 || f.pages > maxPages) throw invalid('PAGES', { index, maxPages });
}

/** Storage keys never carry user-controlled path segments. */
export function sanitizeFileName(name: string): string {
  const clean = name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  return (clean || 'file').slice(-80);
}

export const targetOf = (t: z.output<typeof UploadTarget> | undefined): Target | null =>
  !t ? null : 'expenseId' in t ? { kind: 'expense', id: t.expenseId } : { kind: 'settlement', id: t.settlementId };

/**
 * Checks that the caller may attach files to `target` (FR-001/FR-006): expenses they can see and
 * that are active; payments they emitted that are still pending or confirmed.
 */
export async function assertCanAttach(tx: Transaction, loaded: LoadedTrip, target: Target, uid: string): Promise<Doc> {
  const doc = await tx.get(targetPath(loaded.trip.id, target));
  if (target.kind === 'expense') {
    if (!doc || !canViewExpense(loaded.me.data, doc.data as unknown as ExpenseDoc)) throw notFound('Expense');
    if (doc.data['status'] !== 'active') throw new AppError('INVALID_TRANSITION', 'The expense is voided');
    return doc;
  }
  if (!doc) throw notFound('Settlement');
  if (doc.data['fromUid'] !== uid) throw forbidden('Only the emitter can attach a payment proof');
  if (!['pending', 'confirmed'].includes(doc.data['status'] as string)) {
    throw new AppError('INVALID_TRANSITION', 'The payment is no longer open');
  }
  return doc;
}

const activeAttachments = (tx: Transaction, tripId: string, target: Target) =>
  tx.query(attachmentsPath(tripId, target), { where: [['status', '==', 'active']] });

/**
 * POST /uploads: registers pending uploads and returns presigned PUT URLs (the browser uploads
 * straight to storage; the Worker never proxies file bytes).
 */
export async function createUploads(
  db: Firestore,
  storage: ReceiptStorageProvider,
  tripId: string,
  body: z.output<typeof CreateUploadsBody>,
  ctx: MutationContext,
) {
  body.files.forEach(validateFile);
  const target = targetOf(body.target);
  const created = await db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    if (target) {
      await assertCanAttach(tx, loaded, target, ctx.actorUid);
      const existing = await activeAttachments(tx, tripId, target);
      for (const [index, f] of body.files.entries()) {
        const dup = existing.find((a) => a.data['sha256'] === f.sha256);
        if (dup) throw new AppError('ATTACHMENT_DUPLICATE', 'This file is already attached', { existingId: dup.id, index });
      }
      if (existing.length + body.files.length > MAX_ATTACHMENTS_PER_TARGET) {
        throw invalid('TOO_MANY', { max: MAX_ATTACHMENTS_PER_TARGET });
      }
    }
    return body.files.map((f) => {
      const id = newId();
      const data: UploadData = {
        storageKey: `trips/${tripId}/uploads/${id}/${sanitizeFileName(f.fileName)}`,
        fileName: f.fileName,
        mimeType: f.mimeType,
        bytes: f.bytes,
        pages: f.pages,
        sha256: f.sha256,
        uploadedBy: ctx.actorUid,
        status: 'pending',
        target,
        createdAt: ctx.now,
        expiresAt: new Date(ctx.now.getTime() + PENDING_UPLOAD_TTL_MS),
        version: 1,
      };
      tx.set(uploadPath(tripId, id), { ...data, schemaVersion: UPLOAD_SCHEMA_VERSION }, { exists: false });
      return { id, data };
    });
  });
  const uploads = await Promise.all(
    created.map(async ({ id, data }) => {
      const signed = await storage.presignPut(data.storageKey, data.mimeType, data.bytes);
      return { id, uploadUrl: signed.url, headers: signed.headers, expiresAt: signed.expiresAt.toISOString() };
    }),
  );
  return { uploads };
}

export interface VerifiedUpload {
  id: string;
  data: UploadData;
}

/** Marks an upload whose stored object is unusable as deleted and removes the object. */
async function discardUpload(db: Firestore, storage: ReceiptStorageProvider, tripId: string, id: string, key: string) {
  await db.runTransaction(async (tx) => {
    tx.update(uploadPath(tripId, id), { status: 'deleted', deletedAt: new Date() });
  });
  await storage.delete(key).catch(() => log('warn', 'upload_delete_failed', { tripId, uploadId: id }));
}

/**
 * Checks (outside the transaction, since it calls storage) that every upload belongs to the
 * caller, is pending, and that the stored object matches what was declared (size and type).
 */
export async function verifyUploads(
  db: Firestore,
  storage: ReceiptStorageProvider,
  tripId: string,
  uploadIds: string[],
  uid: string,
  now: Date,
): Promise<VerifiedUpload[]> {
  const ids = [...new Set(uploadIds)];
  const docs = await db.batchGet(ids.map((id) => uploadPath(tripId, id)));
  const out: VerifiedUpload[] = [];
  for (const id of ids) {
    const doc = docs.get(uploadPath(tripId, id));
    const data = doc?.data as unknown as UploadData | undefined;
    if (!data || data.uploadedBy !== uid) throw invalid('UNKNOWN_UPLOAD', { uploadId: id });
    if (data.status !== 'pending' || data.expiresAt.getTime() < now.getTime()) throw invalid('NOT_PENDING', { uploadId: id });
    const head = await storage.head(data.storageKey);
    const type = head?.contentType.split(';')[0]!.trim().toLowerCase();
    if (!head || head.bytes !== data.bytes || type !== data.mimeType) {
      await discardUpload(db, storage, tripId, id, data.storageKey);
      throw invalid('MISMATCH', { uploadId: id });
    }
    out.push({ id, data });
  }
  return out;
}

/**
 * Turns verified uploads into attachments of `target` inside the caller's transaction (expense
 * creation, attach-to-existing and payment proofs share it). Re-reads the uploads so a concurrent
 * link cannot attach the same upload twice. Duplicate content is skipped (`skip`, used for new
 * expenses whose scan contained the same page twice) or rejected (`error`).
 */
export async function linkUploadsTx(
  tx: Transaction,
  tripId: string,
  verified: VerifiedUpload[],
  target: Target,
  ctx: MutationContext,
  opts: { source: 'manual' | 'scan' | ((uploadId: string) => 'manual' | 'scan'); isNewTarget: boolean; onDuplicate: 'skip' | 'error' },
): Promise<Attachment[]> {
  if (verified.length === 0) return [];
  const sourceOf = (id: string) => (typeof opts.source === 'function' ? opts.source(id) : opts.source);
  const fresh = await tx.getAll(verified.map((v) => uploadPath(tripId, v.id)));
  const existing = opts.isNewTarget ? [] : await activeAttachments(tx, tripId, target);
  const seen = new Map(existing.map((d) => [d.data['sha256'] as string, d.id]));
  const linked: Attachment[] = [];
  for (const v of verified) {
    const current = fresh.get(uploadPath(tripId, v.id))?.data as unknown as UploadData | undefined;
    if (!current || current.status !== 'pending' || current.uploadedBy !== ctx.actorUid) {
      throw invalid('NOT_PENDING', { uploadId: v.id });
    }
    if (current.target && (current.target.kind !== target.kind || current.target.id !== target.id)) {
      throw invalid('OTHER_TARGET', { uploadId: v.id });
    }
    const dup = seen.get(current.sha256);
    if (dup) {
      if (opts.onDuplicate === 'error') throw new AppError('ATTACHMENT_DUPLICATE', 'This file is already attached', { existingId: dup });
      continue;
    }
    seen.set(current.sha256, v.id);
    const attachment: AttachmentData = {
      tripId,
      storageKey: current.storageKey,
      fileName: current.fileName,
      mimeType: current.mimeType,
      bytes: current.bytes,
      pages: current.pages,
      sha256: current.sha256,
      uploadedBy: current.uploadedBy,
      uploadedAt: current.createdAt,
      expiresAt: attachmentExpiry(current.createdAt),
      status: 'active',
      source: sourceOf(v.id),
      deletedAt: null,
      deleteAttempts: 0,
      version: 1,
    };
    tx.set(`${attachmentsPath(tripId, target)}/${v.id}`, { ...attachment, schemaVersion: ATTACHMENT_SCHEMA_VERSION }, { exists: false });
    tx.update(uploadPath(tripId, v.id), { status: 'linked', linkedTo: target, linkedAt: ctx.now, version: current.version + 1 });
    linked.push(toAttachmentDto(v.id, attachment));
  }
  if (seen.size > MAX_ATTACHMENTS_PER_TARGET) throw invalid('TOO_MANY', { max: MAX_ATTACHMENTS_PER_TARGET });
  writeAudit(
    tx,
    {
      tripId,
      actorUid: ctx.actorUid,
      action: 'attachment.add',
      entityType: 'attachment',
      entityId: target.id,
      beforeVersion: null,
      afterVersion: null,
      correlationId: ctx.correlationId,
      diff: { target: target.kind, attachmentIds: linked.map((a) => a.id), sources: linked.map((a) => a.source) },
    },
    ctx.now,
  );
  return linked;
}
