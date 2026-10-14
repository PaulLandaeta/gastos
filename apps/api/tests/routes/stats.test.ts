import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const { ana, pedro, juan, eve } = users;

beforeAll(clearFirestore);

describe('GET /v1/trips/{t}/stats', () => {
  it('public total for everyone, own stats, visible-scope categories for members, trip-wide for managers', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid], 9000));
    await postExpense(pedro, trip.id, { ...equalExpense(pedro.uid, [ana.uid, pedro.uid], 3000), categoryId: 'default-transport' });
    const personal = equalExpense(ana.uid, [ana.uid], 1200);
    await postExpense(ana, trip.id, { ...personal, categoryId: 'default-shopping', items: [{ ...personal.items[0], classification: 'personal' }] });

    const juanStats = await call(juan, 'GET', `/v1/trips/${trip.id}/stats`);
    expect(juanStats.status).toBe(200);
    expect(juanStats.json).toMatchObject({
      currency: 'USD',
      sharedTotalMinor: 12000,
      expenseCount: 3,
      me: { contributedMinor: 0, sharedConsumedMinor: 3000, personalConsumedMinor: 0, globalConsumedMinor: 3000, balanceMinor: -3000 },
      byCategory: { 'default-food': 9000 },
    });
    expect(juanStats.json.members).toBeUndefined();

    const anaStats = await call(ana, 'GET', `/v1/trips/${trip.id}/stats`);
    expect(anaStats.json.me).toMatchObject({ contributedMinor: 10200, sharedConsumedMinor: 4500, personalConsumedMinor: 1200, globalConsumedMinor: 5700 });
    expect(anaStats.json.byCategory).toEqual({ 'default-food': 9000, 'default-transport': 3000 });
    expect(anaStats.json.members).toHaveLength(3);
    expect(anaStats.json.members.find((m: { uid: string }) => m.uid === pedro.uid)).toMatchObject({ contributedMinor: 3000, sharedConsumedMinor: 4500 });
  });

  it('works for a trip without expenses and hides the trip from strangers', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const res = await call(pedro, 'GET', `/v1/trips/${trip.id}/stats`);
    expect(res.json).toMatchObject({ sharedTotalMinor: 0, expenseCount: 0, me: { globalConsumedMinor: 0, balanceMinor: 0 }, byCategory: {} });
    expect((await call(eve, 'GET', `/v1/trips/${trip.id}/stats`)).status).toBe(404);
  });
});
