import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { rebuildProjections, type ExpenseForProjection } from '../../src/services/projections.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

async function stored(tripId: string) {
  const [pub, cats, stats, expenses] = await Promise.all([
    db.get(`trips/${tripId}/projections/public`),
    db.get(`trips/${tripId}/projections/categories`),
    db.query(`trips/${tripId}/memberStats`),
    db.query(`trips/${tripId}/expenses`),
  ]);
  const strip = ({ schemaVersion: _s, version: _v, ...rest }: Record<string, unknown>) => rest;
  return {
    pub: pub ? strip(pub.data) : null,
    cats: cats ? strip(cats.data) : null,
    stats: Object.fromEntries(stats.map((s) => [s.id, strip(s.data)])),
    active: expenses.filter((e) => e.data['status'] === 'active').map((e) => e.data as unknown as ExpenseForProjection),
  };
}

describe('incremental projections', () => {
  it('create and void keep public, categories and memberStats equal to a full rebuild', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid], 9000));
    const personal = {
      ...equalExpense(pedro.uid, [ana.uid], 1200),
      categoryId: 'default-shopping',
      items: [{ ...equalExpense(pedro.uid, [ana.uid], 1200).items[0], classification: 'personal' }],
    };
    await postExpense(pedro, trip.id, personal);
    const toVoid = await postExpense(juan, trip.id, { ...equalExpense(juan.uid, [pedro.uid, juan.uid], 777), categoryId: 'default-transport' });
    await call(juan, 'POST', `/v1/trips/${trip.id}/expenses/${toVoid.json.expense.id}/void`, { body: { expectedVersion: 1 } });

    const s = await stored(trip.id);
    const rebuilt = rebuildProjections(s.active);
    expect(s.pub).toEqual(rebuilt.public);
    expect(s.cats).toEqual(rebuilt.categories);
    for (const [uid, stats] of Object.entries(rebuilt.memberStats)) expect(s.stats[uid]).toEqual(stats);

    expect(s.pub).toEqual({ sharedTotalMinor: 9000, expenseCount: 2 });
    expect(s.stats[ana.uid]).toMatchObject({
      contributedMinor: 9000,
      sharedConsumedMinor: 3000,
      personalConsumedMinor: 1200,
      globalConsumedMinor: 4200,
    });
    // Juan cannot see Pedro's personal purchase for Ana: it is not in his visible categories.
    expect(s.stats[juan.uid]).toMatchObject({ visibleSharedByCategory: { 'default-food': 9000 }, visibleExpenseCount: 1 });
  });
});
