import {
  MAX_SCAN_BYTES,
  MAX_SCAN_FILES,
  MAX_SCAN_PAGES,
  hasActiveConsent,
  normalizeDraft,
  type DraftWarning,
  type ReceiptAIProvider,
  type ReceiptDraft,
  type ReceiptStorageProvider,
  type ScanResponse,
} from 'contracts';
import type { Firestore } from '../firestore/client.js';
import { AppError } from '../http/errors.js';
import { log } from '../http/log.js';
import { commitUsage, releaseQuota, reserveQuota, type AiLimits, type Reservation } from './quotas.js';
import { assertMutable, loadTripForMember, type MutationContext } from './tripRepo.js';
import { uploadPath, type UploadData } from './uploads.js';

export const scanPath = (tripId: string, scanId: string) => `trips/${tripId}/scans/${scanId}`;
/** One scan document per (user, Idempotency-Key): replays return the stored draft (FR-018). */
export const scanIdOf = (uid: string, key: string) => `${uid}_${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);

/** A pending scan older than this is considered abandoned (Worker killed mid-call). */
const STALE_PENDING_MS = 60_000;

export interface ScanData {
  requestedBy: string;
  uploadIds: string[];
  provider: string;
  model: string;
  status: 'pending' | 'succeeded' | 'failed';
  draft: ReceiptDraft | null;
  warnings: DraftWarning[];
  pages: number;
  bytes: number;
  latencyMs: number | null;
  errorCode: string | null;
  idempotencyKey: string;
  expenseId: string | null;
  tripRemainingToday: number;
  createdAt: Date;
  completedAt: Date | null;
  version: number;
}

const invalid = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError('ATTACHMENT_INVALID', 'The files cannot be analysed', { reason, ...details });

export interface ScanDeps {
  storage: ReceiptStorageProvider;
  ai: ReceiptAIProvider;
  limits: AiLimits;
}

/**
 * HU-04 / RF-50: analyses the caller's pending uploads with the AI provider. Order (contract):
 * membership + active trip → consent → idempotency → upload validation → atomic quota
 * reservation → provider → normalization → metrics. A provider failure gives the quota back and
 * keeps the uploads for manual registration (FR-014).
 */
export async function scanReceipt(
  db: Firestore,
  tripId: string,
  uploadIds: string[],
  idempotencyKey: string,
  ctx: MutationContext,
  deps: ScanDeps,
): Promise<ScanResponse> {
  const scanId = scanIdOf(ctx.actorUid, idempotencyKey);
  const path = scanPath(tripId, scanId);
  const ids = [...new Set(uploadIds)];

  const started = await db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertMutable(loaded.trip);
    if (loaded.trip.data.status !== 'active') throw new AppError('TRIP_NOT_READY', 'Scanning needs an active trip');
    const [profile, existing] = await Promise.all([tx.get(`users/${ctx.actorUid}`), tx.get(path)]);
    if (!hasActiveConsent(profile?.data['aiConsent'] as never)) {
      throw new AppError('AI_CONSENT_REQUIRED', 'Accept the AI privacy notice before scanning');
    }
    const previous = existing?.data as unknown as ScanData | undefined;
    if (previous) {
      if (previous.requestedBy !== ctx.actorUid) throw new AppError('CONFLICT', 'Idempotency key already used');
      if (previous.status === 'succeeded') return { replay: previous };
      if (previous.status === 'pending' && ctx.now.getTime() - previous.createdAt.getTime() < STALE_PENDING_MS) {
        throw new AppError('CONFLICT', 'This scan is still in progress');
      }
    }

    if (ids.length > MAX_SCAN_FILES) throw invalid('TOO_MANY_FILES', { max: MAX_SCAN_FILES });
    const docs = await tx.getAll(ids.map((id) => uploadPath(tripId, id)));
    const uploads = ids.map((id) => {
      const data = docs.get(uploadPath(tripId, id))?.data as unknown as (UploadData & { scanAttempts?: number }) | undefined;
      if (!data || data.uploadedBy !== ctx.actorUid) throw invalid('UNKNOWN_UPLOAD', { uploadId: id });
      if (data.status !== 'pending' || data.expiresAt.getTime() < ctx.now.getTime()) throw invalid('NOT_PENDING', { uploadId: id });
      return { id, data };
    });
    const pages = uploads.reduce((a, u) => a + u.data.pages, 0);
    const bytes = uploads.reduce((a, u) => a + u.data.bytes, 0);
    if (pages > MAX_SCAN_PAGES) throw invalid('TOO_MANY_PAGES', { max: MAX_SCAN_PAGES });
    if (bytes > MAX_SCAN_BYTES) throw invalid('TOO_LARGE', { maxBytes: MAX_SCAN_BYTES });
    // FR-016: retries per file (first attempt + N retries).
    for (const u of uploads) {
      if ((u.data.scanAttempts ?? 0) > deps.limits.retriesPerFile) {
        throw new AppError('AI_QUOTA_EXCEEDED', 'Too many attempts for this file', { scope: 'file', resetsAt: null, uploadId: u.id });
      }
    }

    const reservation: Reservation = { tripId, uid: ctx.actorUid, provider: deps.ai.name, pages, bytes, at: ctx.now };
    const remaining = await reserveQuota(tx, reservation, deps.limits);
    for (const u of uploads) tx.update(uploadPath(tripId, u.id), { scanAttempts: (u.data.scanAttempts ?? 0) + 1 });
    const scan: ScanData = {
      requestedBy: ctx.actorUid,
      uploadIds: ids,
      provider: deps.ai.name,
      model: deps.ai.model,
      status: 'pending',
      draft: null,
      warnings: [],
      pages,
      bytes,
      latencyMs: null,
      errorCode: null,
      idempotencyKey,
      expenseId: null,
      tripRemainingToday: remaining,
      createdAt: ctx.now,
      completedAt: null,
      version: (previous?.version ?? 0) + 1,
    };
    tx.set(path, { ...scan, schemaVersion: 1 });
    return { reservation, uploads, scan, currency: loaded.trip.data.currency };
  });

  if ('replay' in started) {
    const s = started.replay;
    return { scanId, draft: s.draft!, warnings: s.warnings, quota: { tripRemainingToday: s.tripRemainingToday } };
  }

  const { reservation, uploads, scan, currency } = started;
  const t0 = Date.now();
  let draft: ReceiptDraft;
  try {
    const files = await Promise.all(
      uploads.map(async (u) => {
        const data = await deps.storage.get(u.data.storageKey);
        if (!data || data.byteLength !== u.data.bytes) throw invalid('MISMATCH', { uploadId: u.id });
        return { mimeType: u.data.mimeType, data };
      }),
    );
    const raw = await deps.ai.extract({ files, currencyHint: currency });
    draft = normalizeDraft(raw, { currency, today: ctx.now.toISOString().slice(0, 10) });
  } catch (e) {
    const code = e instanceof AppError ? e.code : 'AI_UNAVAILABLE';
    // Only the error class is logged, never receipt content (FR-019).
    log('warn', 'scan_failed', { tripId, scanId, provider: deps.ai.name, code });
    await db.runTransaction(async (tx) => {
      await releaseQuota(tx, reservation);
      tx.update(path, { status: 'failed', errorCode: code, completedAt: new Date(), latencyMs: Date.now() - t0, version: scan.version + 1 });
    });
    if (e instanceof AppError && e.code === 'ATTACHMENT_INVALID') throw e;
    throw new AppError('AI_UNAVAILABLE', 'The receipt could not be analysed; register it manually');
  }

  // FR edge case: the same page twice in one analysis.
  const hashes = uploads.map((u) => u.data.sha256);
  if (new Set(hashes).size < hashes.length && !draft.warnings.includes('DUPLICATE_PAGE')) draft.warnings.push('DUPLICATE_PAGE');
  const latencyMs = Date.now() - t0;
  await db.runTransaction(async (tx) => {
    await commitUsage(tx, reservation, latencyMs);
    tx.update(path, { status: 'succeeded', draft: { ...draft }, warnings: draft.warnings, latencyMs, completedAt: new Date(), version: scan.version + 1 });
  });
  return { scanId, draft, warnings: draft.warnings, quota: { tripRemainingToday: scan.tripRemainingToday } };
}
