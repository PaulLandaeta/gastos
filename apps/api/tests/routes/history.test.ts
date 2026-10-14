import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense, tripVersion } from '../helpers/trips.js';

const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

describe('GET /v1/trips/{t}/expenses/{e}/history', () => {
  it('viewers and managers get create and void events; non-involved members get 404', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const e = await postExpense(pedro, trip.id, equalExpense(pedro.uid, [pedro.uid]));
    await call(pedro, 'POST', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/void`, { body: { expectedVersion: 1 } });

    const own = await call(pedro, 'GET', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/history`);
    expect(own.status).toBe(200);
    expect(own.json.events.map((x: { action: string }) => x.action)).toEqual(['expense.create', 'expense.void']);
    expect(own.json.events[0]).toMatchObject({ actorUid: pedro.uid, afterVersion: 1 });
    expect(typeof own.json.events[0].timestamp).toBe('string');

    expect((await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/history`)).status).toBe(200);
    expect((await call(juan, 'GET', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/history`)).status).toBe(404);
  });

  it('non-involved members cannot void (404, no existence leak) and unknown ids are 404', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const e = await postExpense(pedro, trip.id, equalExpense(pedro.uid, [pedro.uid]));
    const res = await call(juan, 'POST', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/void`, { body: { expectedVersion: 1 } });
    expect(res.status).toBe(404);
    expect((await call(pedro, 'GET', `/v1/trips/${trip.id}/expenses/nope/history`)).status).toBe(404);
    expect(await tripVersion(ana, trip.id)).toBeGreaterThan(0);
  });
});
