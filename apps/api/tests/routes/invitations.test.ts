import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { accept, activeTrip, createTrip } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis, eve } = users;

beforeAll(clearFirestore);

async function memberKeyOf(tripId: string, email: string): Promise<string> {
  const rows = await db.query(`trips/${tripId}/members`, { where: [['email', '==', email]] });
  return rows[0]!.id;
}

describe('POST /v1/trips/{id}/invitations', () => {
  it('only the creator can invite; adding an invitee moves an active trip back to pending', async () => {
    const trip = await activeTrip(ana, [pedro]);
    expect(trip.status).toBe('active');
    const byMember = await call(pedro, 'POST', `/v1/trips/${trip.id}/invitations`, {
      body: { expectedVersion: trip.version, emails: [juan.email] },
    });
    expect(byMember.status).toBe(403);
    const res = await call(ana, 'POST', `/v1/trips/${trip.id}/invitations`, {
      body: { expectedVersion: trip.version, emails: [juan.email] },
    });
    expect(res.status).toBe(201);
    expect(res.json.trip).toMatchObject({ status: 'pending', pendingInvitationCount: 1 });
    expect(res.json.members.some((m: { email: string }) => m.email === juan.email)).toBe(true);
  });

  it('rejects e-mails already invited or already members', async () => {
    const trip = await activeTrip(ana, [pedro]);
    for (const email of [pedro.email, ana.email]) {
      const res = await call(ana, 'POST', `/v1/trips/${trip.id}/invitations`, {
        body: { expectedVersion: trip.version, emails: [email] },
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('DUPLICATE_INVITATION');
    }
  });
});

describe('DELETE /v1/trips/{id}/invitations/{memberKey}', () => {
  it('removes a pending invitee and re-activates the trip', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email, juan.email] });
    await accept(pedro, trip.id);
    const key = await memberKeyOf(trip.id, juan.email);
    const current = (await call(ana, 'GET', `/v1/trips/${trip.id}`)).json.trip;
    const res = await call(ana, 'DELETE', `/v1/trips/${trip.id}/invitations/${key}?expectedVersion=${current.version}`);
    expect(res.status).toBe(200);
    expect(res.json.trip).toMatchObject({ status: 'active', pendingInvitationCount: 0 });
    expect(await db.get(`invitations/${juan.email}/trips/${trip.id}`)).toBeNull();
  });

  it('removes a declined invitee', async () => {
    const trip = await createTrip(ana, { inviteEmails: [luis.email] });
    expect((await call(luis, 'POST', `/v1/trips/${trip.id}/invitations/decline`)).status).toBe(200);
    const key = await memberKeyOf(trip.id, luis.email);
    const current = (await call(ana, 'GET', `/v1/trips/${trip.id}`)).json.trip;
    expect(current).toMatchObject({ status: 'pending', declinedInvitationCount: 1 });
    const res = await call(ana, 'DELETE', `/v1/trips/${trip.id}/invitations/${key}?expectedVersion=${current.version}`);
    expect(res.status).toBe(200);
    expect(res.json.trip).toMatchObject({ status: 'active', declinedInvitationCount: 0 });
  });

  it('never removes an accepted participant (MEMBER_ALREADY_ACCEPTED), even before the first expense', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const res = await call(ana, 'DELETE', `/v1/trips/${trip.id}/invitations/${pedro.uid}?expectedVersion=${trip.version}`);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('MEMBER_ALREADY_ACCEPTED');
  });

  it('returns 404 for unknown member keys', async () => {
    const trip = await createTrip(ana);
    const res = await call(ana, 'DELETE', `/v1/trips/${trip.id}/invitations/inv_nope?expectedVersion=${trip.version}`);
    expect(res.status).toBe(404);
  });
});

describe('accept / decline', () => {
  it('accepting with the verified invited e-mail joins the trip with the next join order', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email, juan.email] });
    const first = await accept(pedro, trip.id);
    expect(first.status).toBe(200);
    expect(first.json.member).toMatchObject({ uid: pedro.uid, role: 'member', invitationStatus: 'accepted', joinOrder: 1 });
    expect(first.json.trip.status).toBe('pending');
    const second = await accept(juan, trip.id);
    expect(second.json.member.joinOrder).toBe(2);
    expect(second.json.trip).toMatchObject({ status: 'active', memberCount: 3, pendingInvitationCount: 0 });
    expect(await db.get(`invitations/${pedro.email}/trips/${trip.id}`)).toBeNull();
    expect((await db.get(`users/${juan.uid}/trips/${trip.id}`))?.data['status']).toBe('active');
    expect((await db.get(`users/${ana.uid}/trips/${trip.id}`))?.data['status']).toBe('active');
  });

  it('requires a verified e-mail', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
    const res = await accept({ ...pedro, emailVerified: false }, trip.id);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('a different e-mail cannot see or accept the invitation (404)', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
    const res = await accept(eve, trip.id);
    expect(res.status).toBe(404);
  });

  it('declining keeps the trip pending until the creator resolves it', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
    const res = await call(pedro, 'POST', `/v1/trips/${trip.id}/invitations/decline`);
    expect(res.status).toBe(200);
    const current = (await call(ana, 'GET', `/v1/trips/${trip.id}`)).json.trip;
    expect(current).toMatchObject({ status: 'pending', pendingInvitationCount: 0, declinedInvitationCount: 1 });
    expect((await db.get(`invitations/${pedro.email}/trips/${trip.id}`))?.data['status']).toBe('declined');
    const late = await accept(pedro, trip.id);
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe('INVALID_TRANSITION');
  });
});
