import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { app } from '../../src/index.js';
import { Firestore } from '../../src/firestore/client.js';
import { LocalStorageProvider } from '../../src/providers/localStorage.js';
import { runRetention } from '../../src/services/retention.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, anaOwesPedro, equalExpense, pay, postExpense } from '../helpers/trips.js';
import { jpeg, upload } from '../helpers/uploads.js';

const db = new Firestore(env);
const storage = new LocalStorageProvider(env.LOCAL_BLOBS!, env.LOCAL_BLOB_SECRET!, env.PUBLIC_API_URL!);
const { ana, pedro } = users;
const SEVEN_MONTHS = 7 * 31 * 86_400_000;

beforeEach(clearFirestore);
afterEach(() => {
  vi.restoreAllMocks();
});

async function expenseWithReceipts(texts: string[]) {
  const trip = await activeTrip(ana, [pedro]);
  const ids = await upload(ana, trip.id, texts.map((t) => jpeg(t)));
  const expenseId = (await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid]), attachmentUploadIds: ids })).json.expense.id as string;
  return { trip, ids, expenseId };
}

describe('runRetention (US4, RF-52)', () => {
  it('deletes expired receipts exactly once, keeps the expense and balances, audits', async () => {
    const { trip, ids, expenseId } = await expenseWithReceipts(['r1', 'r2']);
    const before = (await call(ana, 'GET', `/v1/trips/${trip.id}/balances?view=original`)).json;
    const keys = await Promise.all(ids.map(async (id) => (await db.get(`trips/${trip.id}/expenses/${expenseId}/attachments/${id}`))!.data['storageKey'] as string));

    // Not yet due: nothing happens.
    expect((await runRetention(db, storage, new Date())).expired).toBe(0);

    const later = new Date(Date.now() + SEVEN_MONTHS);
    const first = await runRetention(db, storage, later);
    expect(first.expired).toBe(2);
    expect(await runRetention(db, storage, later)).toMatchObject({ expired: 0, failed: 0 });

    for (const k of keys) expect(await env.LOCAL_BLOBS!.head(k)).toBeNull();
    const list = (await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments`)).json.attachments;
    expect(list.map((a: { status: string }) => a.status)).toEqual(['deleted', 'deleted']);
    expect(list[0].deletedAt).toBe(later.toISOString());
    expect((await db.get(`trips/${trip.id}/expenses/${expenseId}`))!.data).toMatchObject({ attachmentCount: 0, version: 1, totalMinor: 1000 });
    expect((await call(ana, 'GET', `/v1/trips/${trip.id}/balances?view=original`)).json).toEqual(before);
    const audit = await db.query(`trips/${trip.id}/auditEvents`, { where: [['action', '==', 'attachment.expire']] });
    expect(audit).toHaveLength(2);
    expect((await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments/${ids[0]}/url`)).status).toBe(404);
  });

  it('payment proofs expire too; storage failures are retried later', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await anaOwesPedro(trip.id, ana, pedro, 2000);
    const settlementId = (await pay(ana, trip.id, pedro.uid, 1000)).json.settlement.id as string;
    const [u] = await upload(ana, trip.id, [jpeg('proof')], { settlementId });
    await call(ana, 'POST', `/v1/trips/${trip.id}/settlements/${settlementId}/attachments`, { body: { uploadIds: [u] } });
    const later = new Date(Date.now() + SEVEN_MONTHS);

    const spy = vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('B2 down'));
    const failed = await runRetention(db, storage, later);
    expect(failed).toMatchObject({ expired: 0, failed: 1 });
    const path = `trips/${trip.id}/settlements/${settlementId}/attachments/${u}`;
    expect((await db.get(path))!.data).toMatchObject({ status: 'active', deleteAttempts: 1 });
    spy.mockRestore();
    expect((await runRetention(db, storage, later)).expired).toBe(1);
    expect((await db.get(path))!.data['status']).toBe('deleted');
    expect((await db.get(`trips/${trip.id}/settlements/${settlementId}`))!.data).toMatchObject({ status: 'pending', amountMinor: 1000 });
  });

  it('cleans pending uploads older than 24 h and respects the batch limit', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const ids = await upload(ana, trip.id, ['a', 'b', 'c'].map((t) => jpeg(t)));
    expect((await runRetention(db, storage, new Date(Date.now() + 23 * 3_600_000))).cleanedUploads).toBe(0);
    const tomorrow = new Date(Date.now() + 25 * 3_600_000);
    expect((await runRetention(db, storage, tomorrow, 2)).cleanedUploads).toBe(2);
    expect((await runRetention(db, storage, tomorrow, 2)).cleanedUploads).toBe(1);
    for (const id of ids) expect((await db.get(`trips/${trip.id}/uploads/${id}`))!.data['status']).toBe('deleted');
  });

  it('expiring receipts are listed only for those who can see them (FR-022)', async () => {
    const { trip, ids, expenseId } = await expenseWithReceipts(['soon']);
    const juanTrip = trip.id;
    const path = `trips/${trip.id}/expenses/${expenseId}/attachments/${ids[0]}`;
    expect((await call(ana, 'GET', `/v1/trips/${trip.id}/attachments/expiring`)).json.attachments).toEqual([]);
    await db.runTransaction(async (tx) => {
      tx.update(path, { expiresAt: new Date(Date.now() + 10 * 86_400_000) });
    });
    const res = await call(pedro, 'GET', `/v1/trips/${trip.id}/attachments/expiring`);
    expect(res.json.attachments).toEqual([expect.objectContaining({ id: ids[0], label: 'Cena', target: { expenseId } })]);
    expect((await call(users.eve, 'GET', `/v1/trips/${juanTrip}/attachments/expiring`)).status).toBe(404);
  });

  it('the emulator trigger and the scheduled() handler run the job', async () => {
    await expenseWithReceipts(['x']);
    const later = new Date(Date.now() + SEVEN_MONTHS).toISOString();
    const res = await app.request(`/local-admin/run-retention?now=${encodeURIComponent(later)}`, { method: 'POST' }, env);
    expect(await res.json()).toMatchObject({ expired: 1 });
    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.now(), cron: '17 * * * *', noRetry() {} } as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);
  });
});

describe('feature 005: expiring notices and notification retention', () => {
  it('announces a receipt entering the 14-day window once, to the people who see the expense', async () => {
    const { trip, ids, expenseId } = await expenseWithReceipts(['aviso']);
    const path = `trips/${trip.id}/expenses/${expenseId}/attachments/${ids[0]}`;
    const notices = async (uid: string) =>
      (await db.query(`users/${uid}/notifications`)).filter((d) => d.data['type'] === 'attachment.expiring');

    expect((await runRetention(db, storage, new Date())).expiringNotified).toBe(0);
    await db.runTransaction(async (tx) => {
      tx.update(path, { expiresAt: new Date(Date.now() + 10 * 86_400_000) });
    });
    expect((await runRetention(db, storage, new Date())).expiringNotified).toBe(1);
    expect((await runRetention(db, storage, new Date())).expiringNotified).toBe(0); // idempotent
    for (const u of [ana, pedro]) {
      const [n] = await notices(u.uid);
      expect(n!.data).toMatchObject({ link: `/trips/${trip.id}/expenses/${expenseId}`, actorUid: 'system' });
    }
    expect(await notices(users.juan.uid)).toEqual([]);
    expect((await db.get(path))!.data['expiringNotifiedAt']).toBeInstanceOf(Date);
  });

  it('deletes notifications older than 90 days', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid]));
    expect(await db.query(`users/${pedro.uid}/notifications`)).toHaveLength(1);
    expect((await runRetention(db, storage, new Date(Date.now() + 89 * 86_400_000))).notificationsPurged).toBe(0);
    expect((await runRetention(db, storage, new Date(Date.now() + 91 * 86_400_000))).notificationsPurged).toBe(1);
    expect(await db.query(`users/${pedro.uid}/notifications`)).toEqual([]);
  });
});
