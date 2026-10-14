import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, eve } = users;

beforeAll(clearFirestore);

const setRole = (actor: typeof ana, tripId: string, uid: string, role: string, expectedVersion: number) =>
  call(actor, 'PUT', `/v1/trips/${tripId}/members/${uid}/role`, { body: { expectedVersion, role } });

describe('PUT /v1/trips/{id}/members/{uid}/role', () => {
  it('the creator promotes and demotes; the index and audit follow', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const up = await setRole(ana, trip.id, pedro.uid, 'admin', trip.version);
    expect(up.status).toBe(200);
    expect(up.json.member).toMatchObject({ uid: pedro.uid, role: 'admin' });
    expect((await db.get(`users/${pedro.uid}/trips/${trip.id}`))?.data['role']).toBe('admin');

    const down = await setRole(ana, trip.id, pedro.uid, 'member', up.json.trip.version);
    expect(down.status).toBe(200);
    expect(down.json.member.role).toBe('member');
    const audit = await db.query(`trips/${trip.id}/auditEvents`, { where: [['action', '==', 'member.role.set']] });
    expect(audit).toHaveLength(2);
  });

  it('an admin can edit the trip but cannot manage roles (FORBIDDEN)', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const up = await setRole(ana, trip.id, pedro.uid, 'admin', trip.version);
    const edit = await call(pedro, 'PATCH', `/v1/trips/${trip.id}`, {
      body: { expectedVersion: up.json.trip.version, name: 'Editado por admin' },
    });
    expect(edit.status).toBe(200);
    const res = await setRole(pedro, trip.id, juan.uid, 'admin', edit.json.trip.version);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('FORBIDDEN');
  });

  it('nobody can change the creator role', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const self = await setRole(ana, trip.id, ana.uid, 'member', trip.version);
    expect(self.status).toBe(403);
    const up = await setRole(ana, trip.id, pedro.uid, 'admin', trip.version);
    const byAdmin = await setRole(pedro, trip.id, ana.uid, 'member', up.json.trip.version);
    expect(byAdmin.status).toBe(403);
  });

  it('targets that are not accepted members → NOT_FOUND; strangers → 404', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
    const res = await setRole(ana, trip.id, pedro.uid, 'admin', trip.version);
    expect(res.status).toBe(404);
    const stranger = await setRole(eve, trip.id, ana.uid, 'admin', trip.version);
    expect(stranger.status).toBe(404);
  });

  it('a stale expectedVersion → CONFLICT; an invalid role → VALIDATION_FAILED', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await setRole(ana, trip.id, pedro.uid, 'admin', trip.version);
    const stale = await setRole(ana, trip.id, pedro.uid, 'member', trip.version);
    expect(stale.status).toBe(409);
    const invalid = await setRole(ana, trip.id, pedro.uid, 'creator', trip.version + 1);
    expect(invalid.status).toBe(422);
  });
});
