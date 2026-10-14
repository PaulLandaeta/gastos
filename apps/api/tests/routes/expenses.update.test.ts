import { env } from 'cloudflare:workers';
import { rebuildLedger, type LedgerEffect } from 'finance-engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { rebuildProjections, type ExpenseForProjection } from '../../src/services/projections.js';
import { clearFirestore, emulatorToken } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense, setStatus, tripVersion } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

const put = (user: typeof ana, tripId: string, id: string, body: unknown) => call(user, 'PUT', `/v1/trips/${tripId}/expenses/${id}`, { body });

async function rulesCanRead(uid: string, path: string): Promise<boolean> {
  const token = emulatorToken({ uid, email: `${uid}@example.com` });
  const res = await fetch(`http://${env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-gastos/databases/(default)/documents/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return res.status === 200;
}

describe('PUT /v1/trips/{t}/expenses/{e}', () => {
  it('author edits; seq preserved; version +1; ledger and projections equal a rebuild; history lists changed fields', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const created = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1000));
    const id = created.json.expense.id;
    const res = await put(ana, trip.id, id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid], 1500), description: 'Cena (ajustada)', expectedVersion: 1 });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.expense).toMatchObject({ seq: 1, version: 2, totalMinor: 1500 });

    const doc = (await db.get(`trips/${trip.id}/expenses/${id}`))!.data;
    expect(doc).toMatchObject({ description: 'Cena (ajustada)', seq: 1, createdBy: ana.uid, viewerUids: [ana.uid, juan.uid, pedro.uid].sort() });
    const ledger = (await db.get(`trips/${trip.id}/projections/ledger`))!.data;
    expect(ledger['netByMember']).toEqual(rebuildLedger([doc['ledgerEffect'] as LedgerEffect], []).netByMember);
    const pub = (await db.get(`trips/${trip.id}/projections/public`))!.data;
    expect(pub).toMatchObject(rebuildProjections([doc as unknown as ExpenseForProjection]).public);

    const history = await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${id}/history`);
    const update = history.json.events.find((e: { action: string }) => e.action === 'expense.update');
    expect(update).toBeTruthy();
    expect(update.changed).toEqual(expect.arrayContaining(['description', 'totalMinor', 'items']));
  });

  it('PRD: conflicto de edición concurrente — one confirms version+1, the other gets CONFLICT', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const id = (await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1000))).json.expense.id;
    const [a, b] = await Promise.all([
      put(ana, trip.id, id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 1000), description: 'A', expectedVersion: 1 }),
      put(ana, trip.id, id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 2000), description: 'B', expectedVersion: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toMatchObject({ code: 'CONFLICT', details: { currentVersion: 2 } });
  });

  it('visibility is recomputed: a removed beneficiary loses read access, a new one gains it', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const id = (await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1000))).json.expense.id;
    expect(await rulesCanRead(juan.uid, `trips/${trip.id}/expenses/${id}`)).toBe(false);
    await put(ana, trip.id, id, { ...equalExpense(ana.uid, [ana.uid, juan.uid], 1000), expectedVersion: 1 });
    expect(await rulesCanRead(juan.uid, `trips/${trip.id}/expenses/${id}`)).toBe(true);
    expect(await rulesCanRead(pedro.uid, `trips/${trip.id}/expenses/${id}`)).toBe(false);
  });

  it('permissions and state: member forbidden (non-viewer 404); voided, closed and inactive category rejected', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const id = (await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1000))).json.expense.id;
    const body = { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 1000), expectedVersion: 1 };
    expect((await put(pedro, trip.id, id, body)).status).toBe(403);
    expect((await put(juan, trip.id, id, body)).status).toBe(404);
    const inactive = await call(ana, 'PATCH', `/v1/trips/${trip.id}/categories/default-shopping`, { body: { expectedVersion: 1, active: false } });
    expect(inactive.status).toBe(200);
    expect((await put(ana, trip.id, id, { ...body, categoryId: 'default-shopping' })).json.error.code).toBe('CATEGORY_INACTIVE');
    expect((await put(ana, trip.id, id, { ...body, totalMinor: 999 })).json.error.code).toBe('NOT_RECONCILED');

    await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${id}/void`, { body: { expectedVersion: 1 } });
    expect((await put(ana, trip.id, id, { ...body, expectedVersion: 2 })).json.error.code).toBe('INVALID_TRANSITION');

    const id2 = (await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid], 700))).json.expense.id;
    await setStatus(ana, trip.id, 'close', await tripVersion(ana, trip.id));
    expect((await put(ana, trip.id, id2, { ...equalExpense(ana.uid, [ana.uid], 700), expectedVersion: 1 })).json.error.code).toBe('TRIP_READ_ONLY');
  });
});
