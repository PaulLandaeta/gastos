import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense, setStatus } from '../helpers/trips.js';

const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

async function withAdmin() {
  const trip = await activeTrip(ana, [pedro, juan]);
  await call(ana, 'PUT', `/v1/trips/${trip.id}/members/${pedro.uid}/role`, { body: { expectedVersion: trip.version, role: 'admin' } });
  return trip.id;
}

describe('categories API', () => {
  it('creator and admins create categories; plain members cannot', async () => {
    const tripId = await withAdmin();
    const byAdmin = await call(pedro, 'POST', `/v1/trips/${tripId}/categories`, { body: { name: 'Excursiones', color: '#123abc' } });
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.json.category).toMatchObject({ name: 'Excursiones', color: '#123abc', active: true, isDefault: false, version: 1 });
    const byMember = await call(juan, 'POST', `/v1/trips/${tripId}/categories`, { body: { name: 'Otra', color: '#000000' } });
    expect(byMember.status).toBe(403);
    const used = await postExpense(juan, tripId, { ...equalExpense(juan.uid, [juan.uid]), categoryId: byAdmin.json.category.id });
    expect(used.status).toBe(201);
  });

  it('names are unique case-insensitively; colors are validated', async () => {
    const tripId = await withAdmin();
    const dup = await call(ana, 'POST', `/v1/trips/${tripId}/categories`, { body: { name: '  comida ', color: '#123456' } });
    expect(dup.json.error.code).toBe('DUPLICATE_CATEGORY');
    const badColor = await call(ana, 'POST', `/v1/trips/${tripId}/categories`, { body: { name: 'X', color: 'red' } });
    expect(badColor.status).toBe(422);
  });

  it('deactivate and reactivate with optimistic versioning; inactive ones are rejected for new expenses', async () => {
    const tripId = await withAdmin();
    const off = await call(ana, 'PATCH', `/v1/trips/${tripId}/categories/default-shopping`, { body: { expectedVersion: 1, active: false } });
    expect(off.status).toBe(200);
    expect(off.json.category).toMatchObject({ active: false, version: 2 });
    const stale = await call(ana, 'PATCH', `/v1/trips/${tripId}/categories/default-shopping`, { body: { expectedVersion: 1, active: true } });
    expect(stale.json.error.code).toBe('CONFLICT');
    const rejected = await postExpense(juan, tripId, { ...equalExpense(juan.uid, [juan.uid]), categoryId: 'default-shopping' });
    expect(rejected.json.error.code).toBe('CATEGORY_INACTIVE');
    const rename = await call(pedro, 'PATCH', `/v1/trips/${tripId}/categories/default-shopping`, { body: { expectedVersion: 2, active: true, name: 'Souvenirs' } });
    expect(rename.json.category).toMatchObject({ active: true, name: 'Souvenirs', version: 3 });
    const member = await call(juan, 'PATCH', `/v1/trips/${tripId}/categories/default-food`, { body: { expectedVersion: 1, active: false } });
    expect(member.status).toBe(403);
    expect((await call(ana, 'PATCH', `/v1/trips/${tripId}/categories/nope`, { body: { expectedVersion: 1, active: false } })).status).toBe(404);
  });

  it('closed trips are read-only for categories', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await setStatus(ana, trip.id, 'close', trip.version);
    const res = await call(ana, 'POST', `/v1/trips/${trip.id}/categories`, { body: { name: 'Tarde', color: '#111111' } });
    expect(res.json.error.code).toBe('TRIP_READ_ONLY');
  });
});
