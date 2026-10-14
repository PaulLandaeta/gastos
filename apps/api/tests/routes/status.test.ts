import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip, setStatus, tripVersion } from '../helpers/trips.js';

const { ana, pedro, juan, luis } = users;

beforeAll(clearFirestore);

async function withAdmin() {
  const trip = await activeTrip(ana, [pedro, juan]);
  const up = await call(ana, 'PUT', `/v1/trips/${trip.id}/members/${pedro.uid}/role`, {
    body: { expectedVersion: trip.version, role: 'admin' },
  });
  return { tripId: trip.id, version: up.json.trip.version as number };
}

describe('POST /v1/trips/{id}/status', () => {
  it('creator or admin close and reopen; closed trips are read-only', async () => {
    const { tripId, version } = await withAdmin();
    const closed = await setStatus(pedro, tripId, 'close', version);
    expect(closed.status).toBe(200);
    expect(closed.json.trip.status).toBe('closed');

    const v = closed.json.trip.version;
    const edit = await call(ana, 'PATCH', `/v1/trips/${tripId}`, { body: { expectedVersion: v, name: 'X' } });
    expect(edit.json.error.code).toBe('TRIP_READ_ONLY');
    const invite = await call(ana, 'POST', `/v1/trips/${tripId}/invitations`, { body: { expectedVersion: v, emails: [luis.email] } });
    expect(invite.json.error.code).toBe('TRIP_READ_ONLY');
    const role = await call(ana, 'PUT', `/v1/trips/${tripId}/members/${juan.uid}/role`, { body: { expectedVersion: v, role: 'admin' } });
    expect(role.json.error.code).toBe('TRIP_READ_ONLY');

    const reopened = await setStatus(ana, tripId, 'reopen', v);
    expect(reopened.json.trip.status).toBe('active');
  });

  it('plain members cannot close', async () => {
    const { tripId, version } = await withAdmin();
    const res = await setStatus(juan, tripId, 'close', version);
    expect(res.status).toBe(403);
  });

  it('only the creator archives and restores; restore returns to the previous status', async () => {
    const { tripId, version } = await withAdmin();
    const byAdmin = await setStatus(pedro, tripId, 'archive', version);
    expect(byAdmin.status).toBe(403);

    const closed = await setStatus(ana, tripId, 'close', version);
    const archived = await setStatus(ana, tripId, 'archive', closed.json.trip.version);
    expect(archived.json.trip).toMatchObject({ status: 'archived', previousStatus: 'closed' });
    const restoreByAdmin = await setStatus(pedro, tripId, 'restore', archived.json.trip.version);
    expect(restoreByAdmin.status).toBe(403);
    const restored = await setStatus(ana, tripId, 'restore', archived.json.trip.version);
    expect(restored.json.trip).toMatchObject({ status: 'closed', previousStatus: null });
  });

  it('a pending trip can be archived and restored back to pending', async () => {
    const trip = await createTrip(ana, { inviteEmails: [luis.email] });
    const archived = await setStatus(ana, trip.id, 'archive', trip.version);
    expect(archived.json.trip).toMatchObject({ status: 'archived', previousStatus: 'pending' });
    const accept = await call(luis, 'POST', `/v1/trips/${trip.id}/invitations/accept`);
    expect(accept.json.error.code).toBe('TRIP_READ_ONLY');
    const restored = await setStatus(ana, trip.id, 'restore', archived.json.trip.version);
    expect(restored.json.trip.status).toBe('pending');
  });

  it.each([
    ['close a pending trip', 'pending', 'close'],
    ['reopen an active trip', 'active', 'reopen'],
    ['restore a non-archived trip', 'active', 'restore'],
  ])('rejects invalid transitions (%s)', async (_label, initial, action) => {
    const trip = initial === 'pending' ? await createTrip(ana, { inviteEmails: [luis.email] }) : await createTrip(ana);
    const res = await setStatus(ana, trip.id, action, trip.version);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('INVALID_TRANSITION');
  });

  it('a stale version → CONFLICT; unknown action → VALIDATION_FAILED', async () => {
    const trip = await createTrip(ana);
    await call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'B' } });
    expect((await setStatus(ana, trip.id, 'close', trip.version)).json.error.code).toBe('CONFLICT');
    expect((await setStatus(ana, trip.id, 'explode', await tripVersion(ana, trip.id))).status).toBe(422);
  });
});
