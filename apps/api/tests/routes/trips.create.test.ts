import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { createTrip } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro } = users;

beforeAll(clearFirestore);

describe('POST /v1/trips', () => {
  it('creates an active trip when there are no invitees', async () => {
    const trip = await createTrip(ana);
    expect(trip).toMatchObject({
      name: 'Uyuni',
      currency: 'USD',
      status: 'active',
      creatorUid: ana.uid,
      participantsLocked: false,
      currencyLocked: false,
      expenseSeq: 0,
      memberCount: 1,
      pendingInvitationCount: 0,
      version: 1,
      schemaVersion: 1,
    });
    const creator = await db.get(`trips/${trip.id}/members/${ana.uid}`);
    expect(creator?.data).toMatchObject({ role: 'creator', invitationStatus: 'accepted', joinOrder: 0 });
    const index = await db.get(`users/${ana.uid}/trips/${trip.id}`);
    expect(index?.data).toMatchObject({ name: 'Uyuni', status: 'active', role: 'creator' });
    const audit = await db.query(`trips/${trip.id}/auditEvents`);
    expect(audit.map((a) => a.data['action'])).toContain('trip.create');
  });

  it('creates a pending trip with normalized invitations and index documents', async () => {
    const trip = await createTrip(ana, { inviteEmails: [' Pedro@Example.com', 'juan@example.com'] });
    expect(trip).toMatchObject({ status: 'pending', pendingInvitationCount: 2, memberCount: 1 });
    const inv = await db.get(`invitations/pedro@example.com/trips/${trip.id}`);
    expect(inv?.data).toMatchObject({ tripName: 'Uyuni', status: 'invited', currency: 'USD' });
    const rows = await db.query(`trips/${trip.id}/members`, { where: [['invitationStatus', '==', 'invited']] });
    expect(rows.map((r) => r.data['email']).sort()).toEqual(['juan@example.com', 'pedro@example.com']);
    expect(rows.every((r) => r.id.startsWith('inv_') && r.data['uid'] === null)).toBe(true);
  });

  it.each([
    ['unknown currency', { currency: 'XXX' }],
    ['end before start', { startDate: '2026-11-05', endDate: '2026-11-01' }],
    ['invalid date', { startDate: '2026-02-30' }],
    ['empty name', { name: '   ' }],
    ['invalid email', { inviteEmails: ['not-an-email'] }],
  ])('rejects %s with VALIDATION_FAILED', async (_label, body) => {
    const res = await call(ana, 'POST', '/v1/trips', {
      body: { name: 'X', startDate: '2026-11-01', endDate: '2026-11-05', currency: 'USD', ...body },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['duplicate invitees', ['pedro@example.com', 'PEDRO@example.com']],
    ['self invitation', ['ana@example.com']],
  ])('rejects %s with DUPLICATE_INVITATION', async (_label, inviteEmails) => {
    const res = await call(ana, 'POST', '/v1/trips', {
      body: { name: 'X', startDate: '2026-11-01', endDate: '2026-11-05', currency: 'USD', inviteEmails },
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('DUPLICATE_INVITATION');
  });

  it('GET /v1/trips/{id} returns the trip and members to members only (404 otherwise)', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
    const own = await call(ana, 'GET', `/v1/trips/${trip.id}`);
    expect(own.status).toBe(200);
    expect(own.json.members).toHaveLength(2);
    const invitee = await call(pedro, 'GET', `/v1/trips/${trip.id}`);
    expect(invitee.status).toBe(404);
    const missing = await call(ana, 'GET', '/v1/trips/does-not-exist');
    expect(missing.status).toBe(404);
  });
});
