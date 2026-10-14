import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip } from '../helpers/trips.js';

const { ana, juan, eve } = users;

beforeAll(clearFirestore);

describe('PATCH /v1/trips/{id}', () => {
  it('lets the creator edit name and dates, bumping the version', async () => {
    const trip = await createTrip(ana);
    const res = await call(ana, 'PATCH', `/v1/trips/${trip.id}`, {
      body: { expectedVersion: trip.version, name: 'Salar de Uyuni', endDate: '2026-11-06' },
    });
    expect(res.status).toBe(200);
    expect(res.json.trip).toMatchObject({ name: 'Salar de Uyuni', endDate: '2026-11-06', version: trip.version + 1 });
  });

  it('rejects a stale expectedVersion with CONFLICT', async () => {
    const trip = await createTrip(ana);
    await call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'A' } });
    const res = await call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'B' } });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatchObject({ code: 'CONFLICT', details: { currentVersion: trip.version + 1 } });
  });

  it('forbids plain members and hides the trip from strangers', async () => {
    const trip = await activeTrip(ana, [juan]);
    const member = await call(juan, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'X' } });
    expect(member.status).toBe(403);
    const stranger = await call(eve, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'X' } });
    expect(stranger.status).toBe(404);
  });

  it('validates the dates against each other', async () => {
    const trip = await createTrip(ana);
    const res = await call(ana, 'PATCH', `/v1/trips/${trip.id}`, {
      body: { expectedVersion: trip.version, endDate: '2026-10-01' },
    });
    expect(res.status).toBe(422);
  });

  it('lets the creator change the currency before the first expense', async () => {
    const trip = await createTrip(ana);
    const res = await call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, currency: 'BOB' } });
    expect(res.status).toBe(200);
    expect(res.json.trip.currency).toBe('BOB');
  });
});
