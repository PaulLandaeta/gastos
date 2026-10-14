import type { CreateExpenseBody } from 'contracts';
import type { z } from 'zod';
import type { Env } from '../env.js';
import type { Firestore } from '../firestore/client.js';
import { AppError } from '../http/errors.js';
import { createStorageProvider } from '../providers/storage.js';
import type { ExpenseAttachments } from './expenses.js';
import { idempotencyPath } from './idempotency.js';
import { scanPath, type ScanData } from './scans.js';
import type { MutationContext } from './tripRepo.js';
import { linkUploadsTx, verifyUploads } from './uploads.js';

/**
 * Prepares the receipts of a new expense (FR-001, FR-013): resolves the scan's uploads, verifies
 * every upload against storage before the transaction and returns the hook that links them inside
 * it. A replay of the same Idempotency-Key skips all of this (the uploads are already linked).
 */
export async function expenseAttachmentsFor(
  db: Firestore,
  env: Env,
  tripId: string,
  body: z.output<typeof CreateExpenseBody>,
  idempotencyKey: string,
  ctx: MutationContext,
): Promise<ExpenseAttachments | undefined> {
  if (!body.scanId && !body.attachmentUploadIds?.length) return undefined;
  if (await db.get(idempotencyPath(tripId, ctx.actorUid, idempotencyKey))) return undefined;

  let scanUploads: string[] = [];
  if (body.scanId) {
    const scan = (await db.get(scanPath(tripId, body.scanId)))?.data as unknown as ScanData | undefined;
    if (!scan || scan.requestedBy !== ctx.actorUid || scan.status !== 'succeeded') {
      throw new AppError('VALIDATION_FAILED', 'Unknown scan', { fields: { scanId: 'unknown' } });
    }
    if (scan.expenseId) throw new AppError('INVALID_TRANSITION', 'This scan was already saved as an expense');
    scanUploads = scan.uploadIds;
  }
  const uploadIds = [...new Set([...scanUploads, ...(body.attachmentUploadIds ?? [])])];
  const verified = await verifyUploads(db, createStorageProvider(env), tripId, uploadIds, ctx.actorUid, ctx.now);
  const fromScan = new Set(scanUploads);
  return {
    source: body.scanId ? 'ai' : 'manual',
    scanId: body.scanId ?? null,
    link: async (tx, expenseId) => {
      if (body.scanId) {
        const fresh = (await tx.get(scanPath(tripId, body.scanId)))?.data as unknown as ScanData | undefined;
        if (!fresh || fresh.expenseId) throw new AppError('INVALID_TRANSITION', 'This scan was already saved as an expense');
        tx.update(scanPath(tripId, body.scanId), { expenseId, version: fresh.version + 1 });
      }
      const linked = await linkUploadsTx(tx, tripId, verified, { kind: 'expense', id: expenseId }, ctx, {
        source: (id) => (fromScan.has(id) ? 'scan' : 'manual'),
        isNewTarget: true,
        onDuplicate: 'skip',
      });
      return linked.length;
    },
  };
}
