import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { FakeReceiptProvider } from '../../src/providers/fakeAi.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip } from '../helpers/trips.js';
import { consent, jpeg, scan, upload } from '../helpers/uploads.js';

const db = new Firestore(env);
const { ana, pedro } = users;
const admin = { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };
const today = () => new Date().toISOString().slice(0, 10);

async function setLimits(limits: Record<string, number> | null) {
  await db.runTransaction(async (tx) => {
    if (limits) tx.set('config/ai', limits);
    else tx.delete('config/ai');
  });
}

beforeEach(async () => {
  await clearFirestore();
});
beforeAll(clearFirestore);
afterEach(async () => {
  vi.restoreAllMocks();
});

const scanOne = async (user: typeof ana, tripId: string, text: string, key?: string) => scan(user, tripId, await upload(user, tripId, [jpeg(text)]), key);

describe('AI quotas (US3, RF-51)', () => {
  it('trip daily limit: the next scan is rejected without calling the provider', async () => {
    await setLimits({ tripDay: 2 });
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    expect((await scanOne(ana, trip.id, 'a')).json.quota.tripRemainingToday).toBe(1);
    expect((await scanOne(ana, trip.id, 'b')).json.quota.tripRemainingToday).toBe(0);
    const spy = vi.spyOn(FakeReceiptProvider.prototype, 'extract');
    const third = await scanOne(ana, trip.id, 'c');
    expect(third.status).toBe(429);
    expect(third.json.error).toMatchObject({ code: 'AI_QUOTA_EXCEEDED', details: { scope: 'trip' } });
    expect(new Date(third.json.error.details.resetsAt).toISOString().slice(11)).toBe('00:00:00.000Z');
    expect(spy).not.toHaveBeenCalled();
    const status = await call(ana, 'GET', `/v1/trips/${trip.id}/scans/quota`);
    expect(status.json).toMatchObject({ tripRemainingToday: 0, tripLimit: 2, exhaustedScope: 'trip' });
    expect((await call(users.eve, 'GET', `/v1/trips/${trip.id}/scans/quota`)).status).toBe(404);
    // Another trip still has its own allowance.
    const other = await activeTrip(pedro, [ana]);
    expect((await scanOne(ana, other.id, 'd')).status).toBe(200);
  });

  it('global day and month limits', async () => {
    await setLimits({ globalDay: 1 });
    const t1 = await activeTrip(ana, [pedro]);
    await consent(ana);
    expect((await scanOne(ana, t1.id, 'a')).status).toBe(200);
    expect((await scanOne(ana, t1.id, 'b')).json.error.details.scope).toBe('global_day');
    await setLimits({ globalMonth: 1 });
    expect((await scanOne(ana, t1.id, 'c')).json.error.details.scope).toBe('global_month');
  });

  it('concurrent scans at the limit: only one passes', async () => {
    await setLimits({ tripDay: 1 });
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    const ids = await Promise.all(['x', 'y', 'z'].map((t) => upload(ana, trip.id, [jpeg(t)])));
    const results = await Promise.all(ids.map((u) => scan(ana, trip.id, u)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.json?.error?.code === 'AI_QUOTA_EXCEEDED')).toHaveLength(2);
    expect((await db.get(`trips/${trip.id}/aiUsage/${today()}`))!.data['requests']).toBe(1);
  });

  it('provider failures give the reservation back; per-file retries are limited', async () => {
    await setLimits({ tripDay: 1, retriesPerFile: 2 });
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    const [u] = await upload(ana, trip.id, [jpeg('FAIL: always')]);
    for (let i = 0; i < 3; i++) expect((await scan(ana, trip.id, [u!])).json.error.code).toBe('AI_UNAVAILABLE');
    const fourth = await scan(ana, trip.id, [u!]);
    expect(fourth.json.error).toMatchObject({ code: 'AI_QUOTA_EXCEEDED', details: { scope: 'file' } });
    // The failures did not use the trip allowance.
    expect((await scanOne(ana, trip.id, 'ok')).status).toBe(200);
    expect((await db.get(`trips/${trip.id}/aiUsage/${today()}`))!.data).toMatchObject({ requests: 1, failures: 3 });
  });

  it('an idempotent retry does not consume twice', async () => {
    await setLimits({ tripDay: 1 });
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    const ids = await upload(ana, trip.id, [jpeg('once')]);
    const key = crypto.randomUUID();
    expect((await scan(ana, trip.id, ids, key)).status).toBe(200);
    expect((await scan(ana, trip.id, ids, key)).status).toBe(200);
    expect((await db.get(`trips/${trip.id}/aiUsage/${today()}`))!.data['requests']).toBe(1);
  });

  it('GET /admin/ai-usage aggregates by day, trip, user and provider; admins only', async () => {
    await setLimits(null);
    const trip = await activeTrip(ana, [pedro]);
    await consent(ana);
    await consent(pedro);
    await scanOne(ana, trip.id, 'a');
    await scanOne(pedro, trip.id, 'b');
    await scanOne(pedro, trip.id, 'FAIL');
    expect((await call(ana, 'GET', '/v1/admin/ai-usage')).status).toBe(403);
    const res = await call(admin, 'GET', `/v1/admin/ai-usage?from=${today()}&to=${today()}`);
    expect(res.status).toBe(200);
    expect(res.json.days).toEqual([{ date: today(), requests: 2, pages: 2, bytes: 2, failures: 1, byProvider: { fake: 2 } }]);
    expect(res.json.trips).toEqual([{ tripId: trip.id, requests: 2, pages: 2, bytes: 2, failures: 1 }]);
    expect(res.json.users).toEqual(expect.arrayContaining([{ uid: ana.uid, requests: 1 }, { uid: pedro.uid, requests: 1 }]));
    expect((await call(admin, 'GET', '/v1/admin/ai-usage?from=2026-13-01&to=x')).status).toBe(422);
  });
});
