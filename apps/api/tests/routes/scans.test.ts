import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { FakeReceiptProvider } from '../../src/providers/fakeAi.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';
import { consent, jpeg, pdf, scan, upload } from '../helpers/uploads.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI consent (FR-015)', () => {
  it('is required, recorded with a date and revocable', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const [u] = await upload(ana, trip.id, [jpeg('ticket')]);
    const spy = vi.spyOn(FakeReceiptProvider.prototype, 'extract');
    const denied = await scan(ana, trip.id, [u!]);
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('AI_CONSENT_REQUIRED');

    const accepted = await consent(ana);
    expect(accepted.status).toBe(200);
    expect(accepted.json.aiConsent).toMatchObject({ version: '2026-10', revokedAt: null });
    expect((await db.get(`users/${ana.uid}`))!.data['aiConsent']).toMatchObject({ version: '2026-10' });
    expect((await call(ana, 'POST', '/v1/me/ai-consent', { body: { version: 'old' } })).status).toBe(422);
    expect((await scan(ana, trip.id, [u!])).status).toBe(200);

    const revoked = await call(ana, 'DELETE', '/v1/me/ai-consent');
    expect(revoked.json.aiConsent.revokedAt).not.toBeNull();
    const [u2] = await upload(ana, trip.id, [jpeg('ticket-2')]);
    expect((await scan(ana, trip.id, [u2!])).json.error.code).toBe('AI_CONSENT_REQUIRED');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /trips/{t}/scans (US1)', () => {
  it('returns a normalized draft with warnings; idempotent with the same key', async () => {
    const trip = await activeTrip(ana, [pedro], { currency: 'USD' });
    await consent(ana);
    const [u] = await upload(ana, trip.id, [jpeg('super-ticket')]);
    const spy = vi.spyOn(FakeReceiptProvider.prototype, 'extract');
    const key = crypto.randomUUID();
    const res = await scan(ana, trip.id, [u!], key);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.draft).toMatchObject({
      merchant: 'Super Ahorro',
      detectedCurrency: 'EUR',
      items: [
        { description: 'Pan', quantity: 2, unitPriceMinor: 300, totalMinor: 600 },
        { description: 'Agua', quantity: 1, totalMinor: 300 },
      ],
      taxMinor: 90,
      totalMinor: 990,
    });
    expect(res.json.draft.lowConfidence).toContain('items.1');
    expect(res.json.warnings).toContain('CURRENCY_MISMATCH');
    expect(res.json.quota.tripRemainingToday).toBe(19);

    const again = await scan(ana, trip.id, [u!], key);
    expect(again.json).toEqual(res.json);
    expect(spy).toHaveBeenCalledTimes(1);
    const usage = (await db.get(`trips/${trip.id}/aiUsage/${new Date().toISOString().slice(0, 10)}`))!.data;
    expect(usage).toMatchObject({ requests: 1, succeeded: 1, pages: 1 });
  });

  it('only the caller’s own pending uploads; limits checked before calling the provider', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    await consent(pedro);
    const spy = vi.spyOn(FakeReceiptProvider.prototype, 'extract');
    const [mine] = await upload(ana, trip.id, [jpeg('a')]);
    expect((await scan(pedro, trip.id, [mine!])).json.error.code).toBe('ATTACHMENT_INVALID');
    expect((await scan(juan, trip.id, [mine!])).status).toBe(404);

    const six = await upload(ana, trip.id, ['1', '2', '3', '4', '5', '6'].map((n) => jpeg(`f${n}`)));
    expect((await scan(ana, trip.id, six)).json.error).toMatchObject({ code: 'ATTACHMENT_INVALID', details: { reason: 'TOO_MANY_FILES' } });
    const pdfs = await upload(ana, trip.id, [pdf('p1', 6), pdf('p2', 5)]);
    expect((await scan(ana, trip.id, pdfs)).json.error.details.reason).toBe('TOO_MANY_PAGES');
    const big = await upload(ana, trip.id, [{ ...jpeg('x'.repeat(4 * 1024 * 1024 + 1)) }]);
    expect((await scan(ana, trip.id, big)).json.error.details.reason).toBe('TOO_LARGE');
    expect(spy).not.toHaveBeenCalled();
  });

  it('the same page twice in one analysis is flagged as DUPLICATE_PAGE', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    const ids = await upload(ana, trip.id, [jpeg('same-page', 'a.jpg'), jpeg('same-page', 'b.jpg')]);
    const res = await scan(ana, trip.id, ids);
    expect(res.json.warnings).toContain('DUPLICATE_PAGE');
  });

  it('provider failure → AI_UNAVAILABLE, quota given back, uploads kept for manual registration', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    const [u] = await upload(ana, trip.id, [jpeg('FAIL: blurry')]);
    const res = await scan(ana, trip.id, [u!]);
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe('AI_UNAVAILABLE');
    const usage = (await db.get(`trips/${trip.id}/aiUsage/${new Date().toISOString().slice(0, 10)}`))!.data;
    expect(usage).toMatchObject({ requests: 0, failures: 1 });
    expect((await db.get(`trips/${trip.id}/uploads/${u}`))!.data['status']).toBe('pending');
    const saved = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid]), attachmentUploadIds: [u] });
    expect(saved.status).toBe(201);
  });

  it('saving the expense with scanId links the analysed files and marks it as scanned (FR-013)', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    const ids = await upload(ana, trip.id, [jpeg('page-1'), jpeg('page-1', 'dup.jpg'), jpeg('page-2')]);
    const scanned = await scan(ana, trip.id, ids);
    const [extra] = await upload(ana, trip.id, [pdf('extra', 1)]);
    const saved = await postExpense(ana, trip.id, {
      ...equalExpense(ana.uid, [ana.uid, pedro.uid], 990),
      scanId: scanned.json.scanId,
      attachmentUploadIds: [extra],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(201);
    const expenseId = saved.json.expense.id;
    expect((await db.get(`trips/${trip.id}/expenses/${expenseId}`))!.data).toMatchObject({
      source: 'ai',
      scanId: scanned.json.scanId,
      attachmentCount: 3,
    });
    const list = (await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments`)).json.attachments as { source: string }[];
    expect(list.map((a) => a.source).sort()).toEqual(['manual', 'scan', 'scan']);
    // A scan is saved only once.
    const again = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 990), scanId: scanned.json.scanId });
    expect(again.json.error.code).toBe('INVALID_TRANSITION');
    // Another user's scan cannot be used.
    await consent(pedro);
    const pedroScan = await scan(pedro, trip.id, await upload(pedro, trip.id, [jpeg('p')]));
    const foreign = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid]), scanId: pedroScan.json.scanId });
    expect(foreign.status).toBe(422);
  });
});
