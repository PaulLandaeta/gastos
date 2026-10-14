import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

const voidE = (u: typeof ana, t: string, e: string, v: number) => call(u, 'POST', `/v1/trips/${t}/expenses/${e}/void`, { body: { expectedVersion: v } });
const restore = (u: typeof ana, t: string, e: string, body: Record<string, unknown>) => call(u, 'POST', `/v1/trips/${t}/expenses/${e}/restore`, { body });

async function snapshot(tripId: string) {
  const [ledger, pub, cats, stats] = await Promise.all([
    db.get(`trips/${tripId}/projections/ledger`),
    db.get(`trips/${tripId}/projections/public`),
    db.get(`trips/${tripId}/projections/categories`),
    db.query(`trips/${tripId}/memberStats`),
  ]);
  const strip = (d?: Record<string, unknown>) => {
    if (!d) return null;
    const { version: _v, sourceRevision: _s, schemaVersion: _sv, ...rest } = d;
    return rest;
  };
  return { ledger: strip(ledger?.data), pub: strip(pub?.data), cats: strip(cats?.data), stats: stats.map((s) => [s.id, strip(s.data)]) };
}

describe('POST /v1/trips/{t}/expenses/{e}/restore', () => {
  it('void + restore leaves ledger and projections identical; history records it', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 900));
    const e = (await postExpense(pedro, trip.id, equalExpense(pedro.uid, [ana.uid, pedro.uid], 1300))).json.expense;
    const before = await snapshot(trip.id);
    expect((await voidE(pedro, trip.id, e.id, 1)).status).toBe(200);
    const res = await restore(pedro, trip.id, e.id, { expectedVersion: 2 });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.expense).toMatchObject({ status: 'active', version: 3 });
    expect(await snapshot(trip.id)).toEqual(before);
    const history = await call(pedro, 'GET', `/v1/trips/${trip.id}/expenses/${e.id}/history`);
    expect(history.json.events.map((x: { action: string }) => x.action)).toEqual(['expense.create', 'expense.void', 'expense.restore']);
  });

  it('permissions like void; active expense → INVALID_TRANSITION; stale version → CONFLICT', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const e = (await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1000))).json.expense;
    expect((await restore(ana, trip.id, e.id, { expectedVersion: 1 })).json.error.code).toBe('INVALID_TRANSITION');
    await voidE(ana, trip.id, e.id, 1);
    expect((await restore(pedro, trip.id, e.id, { expectedVersion: 2 })).status).toBe(403);
    expect((await restore(juan, trip.id, e.id, { expectedVersion: 2 })).status).toBe(404);
    expect((await restore(ana, trip.id, e.id, { expectedVersion: 1 })).json.error.code).toBe('CONFLICT');
  });

  it('restores even if its category was deactivated; duplicate warning applies', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const body = { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 1000), categoryId: 'default-shopping' };
    const e = (await postExpense(ana, trip.id, body)).json.expense;
    await voidE(ana, trip.id, e.id, 1);
    await call(ana, 'PATCH', `/v1/trips/${trip.id}/categories/default-shopping`, { body: { expectedVersion: 1, active: false } });
    await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 1000) });
    const dup = await restore(ana, trip.id, e.id, { expectedVersion: 2 });
    expect(dup.json.error.code).toBe('POSSIBLE_DUPLICATE');
    const ok = await restore(ana, trip.id, e.id, { expectedVersion: 2, confirmDuplicate: true });
    expect(ok.status).toBe(200);
    expect((await db.get(`trips/${trip.id}/expenses/${e.id}`))!.data['categoryId']).toBe('default-shopping');
  });
});
