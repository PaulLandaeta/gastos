import { AiConsentBody, IdempotencyKey, ScanBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { AppError, forbidden } from '../http/errors.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { createAiProvider } from '../providers/ai.js';
import { createStorageProvider } from '../providers/storage.js';
import { revokeAiConsent, setAiConsent } from '../services/consent.js';
import { aiUsageReport, loadLimits, quotaStatus } from '../services/quotas.js';
import { loadTripForMember } from '../services/tripRepo.js';
import { scanReceipt } from '../services/scans.js';
import { syncProfile } from '../services/users.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function scanRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/me/ai-consent', async (c) => {
    parseWith(AiConsentBody, await readJson(c.req.raw));
    await syncProfile(c.get('db'), c.get('user'));
    return c.json(await setAiConsent(c.get('db'), c.get('user').uid, new Date()));
  });

  app.delete('/v1/me/ai-consent', async (c) => {
    await syncProfile(c.get('db'), c.get('user'));
    return c.json(await revokeAiConsent(c.get('db'), c.get('user').uid, new Date()));
  });

  app.post('/v1/trips/:tripId/scans', async (c) => {
    const key = IdempotencyKey.safeParse(c.req.header('idempotency-key'));
    if (!key.success) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header (UUID v4) is required');
    const { uploadIds } = parseWith(ScanBody, await readJson(c.req.raw));
    const db = c.get('db');
    const deps = { storage: createStorageProvider(c.env), ai: createAiProvider(c.env), limits: await loadLimits(db, c.env) };
    return c.json(await scanReceipt(db, c.req.param('tripId'), uploadIds, key.data, mutationContext(c), deps));
  });

  app.get('/v1/trips/:tripId/scans/quota', async (c) => {
    const db = c.get('db');
    const tripId = c.req.param('tripId');
    await db.runTransaction((tx) => loadTripForMember(tx, tripId, c.get('user').uid));
    return c.json(await quotaStatus(db, tripId, await loadLimits(db, c.env), new Date()));
  });

  /** FR-019: usage metrics for the technical admins (ADMIN_UIDS). */
  app.get('/v1/admin/ai-usage', async (c) => {
    const admins = (c.env.ADMIN_UIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!admins.includes(c.get('user').uid)) throw forbidden('Admins only');
    const today = new Date().toISOString().slice(0, 10);
    const from = c.req.query('from') ?? today;
    const to = c.req.query('to') ?? today;
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
      throw new AppError('VALIDATION_FAILED', 'from/to must be YYYY-MM-DD with from <= to');
    }
    return c.json(await aiUsageReport(c.get('db'), from, to));
  });
}
