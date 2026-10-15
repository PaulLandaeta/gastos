import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip, setStatus, tripVersion } from '../helpers/trips.js';

const { ana, juan, pedro, eve } = users;
const db = new Firestore(env);

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

describe('PATCH /v1/trips/{id} spicyMode (feature 007, RF-57)', () => {
  const spicy = (user: typeof ana, tripId: string, expectedVersion: number, spicyMode: unknown) =>
    call(user, 'PATCH', `/v1/trips/${tripId}`, { body: { expectedVersion, spicyMode } });

  it('is off on new trips; the creator turns it on and off, audited', async () => {
    const trip = await activeTrip(ana, [juan]);
    expect(trip.spicyMode ?? false).toBe(false);
    const on = await spicy(ana, trip.id, trip.version, true);
    expect(on.status).toBe(200);
    expect(on.json.trip).toMatchObject({ spicyMode: true, version: trip.version + 1 });
    const off = await spicy(ana, trip.id, on.json.trip.version, false);
    expect(off.json.trip.spicyMode).toBe(false);

    const audit = await db.query(`trips/${trip.id}/auditEvents`, { where: [['action', '==', 'trip.update']] });
    expect(audit.map((a) => a.data['redactedDiff']).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([
      { spicyMode: false },
      { spicyMode: true },
    ]);
  });

  it('lets an admin change it but not a plain member', async () => {
    const trip = await activeTrip(ana, [juan, pedro]);
    const role = await call(ana, 'PUT', `/v1/trips/${trip.id}/members/${pedro.uid}/role`, {
      body: { expectedVersion: trip.version, role: 'admin' },
    });
    expect(role.status).toBe(200);
    const v = await tripVersion(ana, trip.id);
    const member = await spicy(juan, trip.id, v, true);
    expect(member.status).toBe(403);
    expect(member.json.error.code).toBe('FORBIDDEN');
    const admin = await spicy(pedro, trip.id, v, true);
    expect(admin.status).toBe(200);
    expect(admin.json.trip.spicyMode).toBe(true);
  });

  it('rejects a stale version, a non-boolean value and read-only trips', async () => {
    const trip = await activeTrip(ana, [juan]);
    await spicy(ana, trip.id, trip.version, true);
    expect((await spicy(ana, trip.id, trip.version, false)).json.error.code).toBe('CONFLICT');
    const v = await tripVersion(ana, trip.id);
    expect((await spicy(ana, trip.id, v, 'si')).status).toBe(422);

    const closed = await setStatus(ana, trip.id, 'close', v);
    const archived = await setStatus(ana, trip.id, 'archive', closed.json.trip.version);
    const res = await spicy(ana, trip.id, archived.json.trip.version, false);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('TRIP_READ_ONLY');
  });
});
