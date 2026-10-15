import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { createStorageProvider } from '../../src/providers/storage.js';
import { deletionTestHooks, resumeDeletions } from '../../src/services/accountDeletion.js';
import { allDocuments, clearFirestore, type TestUser } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip, equalExpense, pay, postExpense, resolveSettlement, setStatus, tripVersion } from '../helpers/trips.js';
import { jpeg, upload } from '../helpers/uploads.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis } = users;

beforeAll(clearFirestore);
beforeEach(() => {
  deletionTestHooks.failAfterTrips = null;
});

const preview = (u: TestUser) => call(u, 'GET', '/v1/me/deletion-preview');
const deleteAccount = (u: TestUser, body: unknown = { confirm: 'BORRAR' }) => call(u, 'POST', '/v1/me/deletion', { body });
const sync = (u: TestUser) => call(u, 'POST', '/v1/me/sync');

async function nets(u: TestUser, tripId: string) {
  const res = await call(u, 'GET', `/v1/trips/${tripId}/balances?view=original`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return Object.fromEntries((res.json.netByMember as { uid: string; netMinor: number }[]).map((b) => [b.uid, b.netMinor]));
}

async function members(u: TestUser, tripId: string) {
  return (await call(u, 'GET', `/v1/trips/${tripId}`)).json.members as { key: string; uid: string; displayName: string; email: string; role: string; deletedAt: string | null }[];
}

/** Unique test users so each scenario starts with a clean account. */
function person(name: string): TestUser {
  const id = crypto.randomUUID().slice(0, 8);
  return { uid: `uid-${name.toLowerCase()}-${id}`, email: `${name.toLowerCase()}-${id}@example.com`, name: `${name}${id}` };
}

describe('account deletion preview and guards (RF-56)', () => {
  it('previews balances per trip, the creator successor and the receipts to delete', async () => {
    const p = person('Pedro');
    await sync(p);
    const trip = await activeTrip(p, [ana, luis]);
    await call(p, 'PUT', `/v1/trips/${trip.id}/members/${luis.uid}/role`, { body: { role: 'admin', expectedVersion: trip.version } });
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, p.uid], 3000));
    const ids = await upload(p, trip.id, [jpeg('personal-ticket')]);
    const personal = equalExpense(p.uid, [p.uid], 700);
    await postExpense(p, trip.id, { ...personal, items: [{ ...personal.items[0], classification: 'personal' }], attachmentUploadIds: ids });

    const res = await preview(p);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ attachmentsToDelete: 1, blocked: false });
    expect(res.json.trips).toEqual([
      expect.objectContaining({ tripId: trip.id, role: 'creator', balanceMinor: -1500, successor: { uid: luis.uid, displayName: 'Luis' }, pendingSettlements: [] }),
    ]);
  });

  it('validates the confirmation word and requires a recent sign-in', async () => {
    const p = person('Pedro');
    await sync(p);
    expect((await deleteAccount(p, { confirm: 'borrar' })).json.error.code).toBe('VALIDATION_FAILED');
    const stale = await deleteAccount({ ...p, signedInSecondsAgo: 600 });
    expect(stale.status).toBe(401);
    expect(stale.json.error.code).toBe('REAUTH_REQUIRED');
    expect(await db.get(`accountDeletions/${p.uid}`)).toBeNull();
  });

  it('pending payments (as emitter or receiver) block the deletion', async () => {
    const p = person('Pedro');
    const trip = await activeTrip(ana, [p, juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, p.uid, juan.uid], 3000));
    const outgoing = (await pay(p, trip.id, ana.uid, 500)).json.settlement;
    const incoming = (await pay(juan, trip.id, p.uid, 100)).json.settlement;

    const pre = (await preview(p)).json;
    expect(pre.blocked).toBe(true);
    expect(pre.trips[0].pendingSettlements).toEqual(
      expect.arrayContaining([
        { settlementId: outgoing.id, direction: 'outgoing', amountMinor: 500 },
        { settlementId: incoming.id, direction: 'incoming', amountMinor: 100 },
      ]),
    );
    const blocked = await deleteAccount(p);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('ACCOUNT_DELETION_BLOCKED');
    expect(blocked.json.error.details.pendingSettlements).toHaveLength(2);

    await resolveSettlement(ana, trip.id, outgoing.id, 'confirm');
    await resolveSettlement(p, trip.id, incoming.id, 'reject');
    expect((await deleteAccount(p)).json.status).toBe('completed');
  });
});

describe('full deletion keeps the group accounts intact (SC-001, SC-002)', () => {
  it('anonymizes Pedro: same balances, no name or e-mail anywhere, receipts per policy', async () => {
    await clearFirestore();
    for (const u of [ana, pedro, juan]) await sync(u);
    const trip = await activeTrip(ana, [pedro, juan], { name: 'Salar' });

    // Simple shared expense paid by Pedro, item-based expense paid by Ana.
    expect((await postExpense(pedro, trip.id, equalExpense(pedro.uid, [ana.uid, pedro.uid, juan.uid], 3000))).status).toBe(201);
    const items = {
      ...equalExpense(ana.uid, [ana.uid, pedro.uid], 5000),
      splitMode: 'items',
      items: [
        { id: 'a', index: 0, grossMinor: 2000, discountMinor: 0, classification: 'shared', beneficiaries: [ana.uid, pedro.uid, juan.uid], allocation: { mode: 'equal' }, quantity: 2 },
        { id: 'b', index: 1, grossMinor: 3000, discountMinor: 0, classification: 'personal', beneficiaries: [pedro.uid], allocation: { mode: 'equal' } },
      ],
    };
    const itemExpense = await postExpense(ana, trip.id, items);
    expect(itemExpense.status, JSON.stringify(itemExpense.json)).toBe(201);

    // Personal expense of Pedro with a receipt (deleted) and shared one with a receipt (kept).
    const personalIds = await upload(pedro, trip.id, [jpeg('personal')]);
    const personal = equalExpense(pedro.uid, [pedro.uid], 900);
    const personalExpense = (await postExpense(pedro, trip.id, { ...personal, items: [{ ...personal.items[0], classification: 'personal' }], attachmentUploadIds: personalIds })).json.expense;
    const sharedIds = await upload(pedro, trip.id, [jpeg('shared')]);
    const sharedExpense = (await postExpense(pedro, trip.id, { ...equalExpense(pedro.uid, [pedro.uid, juan.uid], 1200), attachmentUploadIds: sharedIds })).json.expense;
    // A pending upload never linked (draft) is deleted too.
    await upload(pedro, trip.id, [jpeg('draft')]);

    // Confirmed payment and a refund.
    const s = (await pay(juan, trip.id, pedro.uid, 400)).json.settlement;
    expect((await resolveSettlement(pedro, trip.id, s.id, 'confirm')).status).toBe(200);
    const refund = await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${itemExpense.json.expense.id}/refunds`, {
      body: { itemId: 'a', quantity: 1, amountMinor: 1000, recipientUid: ana.uid },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(refund.status, JSON.stringify(refund.json)).toBe(201);

    // Pending invitation to Pedro in another trip.
    const other = await createTrip(juan, { name: 'Otro', inviteEmails: [pedro.email] });

    const before = await nets(ana, trip.id);
    expect(Object.values(before).reduce((a, b) => a + b, 0)).toBe(0);

    const res = await deleteAccount(pedro);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toEqual({ status: 'completed', tripsProcessed: 1 });

    // Balances identical, Σ = 0.
    expect(await nets(ana, trip.id)).toEqual(before);
    const list = await members(ana, trip.id);
    const gone = list.find((m) => m.key === pedro.uid)!;
    expect(gone).toMatchObject({ displayName: 'Participante eliminado 1', email: '' });
    expect(gone.deletedAt).not.toBeNull();

    // Profile, indexes and notifications removed; registry completed without PII.
    expect(await db.get(`users/${pedro.uid}`)).toBeNull();
    expect(await db.query(`users/${pedro.uid}/trips`)).toHaveLength(0);
    expect(await db.query(`users/${pedro.uid}/notifications`)).toHaveLength(0);
    const registry = (await db.get(`accountDeletions/${pedro.uid}`))!.data;
    expect(registry).toMatchObject({ status: 'completed', formerNames: [], formerEmail: null, pendingTripIds: [] });

    // Receipts: personal deleted, shared kept; draft upload deleted.
    const personalAtt = await db.query(`trips/${trip.id}/expenses/${personalExpense.id}/attachments`);
    expect(personalAtt.map((a) => a.data['status'])).toEqual(['deleted']);
    const sharedAtt = await db.query(`trips/${trip.id}/expenses/${sharedExpense.id}/attachments`);
    expect(sharedAtt.map((a) => a.data['status'])).toEqual(['active']);
    const uploads = await db.query(`trips/${trip.id}/uploads`, { where: [['status', '==', 'pending']] });
    expect(uploads).toHaveLength(0);

    // Pending invitation removed, the other trip becomes active.
    expect(await db.query(`invitations/${pedro.email}/trips`)).toHaveLength(0);
    const otherNow = (await call(juan, 'GET', `/v1/trips/${other.id}`)).json;
    expect(otherNow.members.map((m: { email: string }) => m.email)).toEqual([juan.email]);
    expect(otherNow.trip.status).toBe('active');

    // Audit without PII.
    const audit = await db.query(`trips/${trip.id}/auditEvents`, { where: [['action', '==', 'member.deleted']] });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data['redactedDiff']).toEqual({ ordinal: 1 });

    // SC-002: exhaustive search in every document of the database.
    const docs = await allDocuments();
    // The walk reaches nested data (expenses, attachments, notifications, audit).
    expect(docs.length).toBeGreaterThan(40);
    expect(docs.some((d) => d.path.includes('/attachments/'))).toBe(true);
    expect(docs.some((d) => d.path.startsWith(`users/${ana.uid}/notifications/`))).toBe(true);
    const leaks = docs.filter((d) => d.json.includes('Pedro') || d.json.includes(pedro.email));
    expect(leaks.map((d) => d.path)).toEqual([]);
    // Ana's notifications about Pedro's expenses no longer carry his name.
    const anaInbox = await db.query(`users/${ana.uid}/notifications`, { where: [['actorUid', '==', pedro.uid]] });
    expect(anaInbox.length).toBeGreaterThan(0);
    expect(anaInbox.every((n) => (n.data['title'] as string).includes('Participante eliminado 1'))).toBe(true);
  });

  it('a deleted account cannot sync, create trips or accept invitations again', async () => {
    expect((await sync(pedro)).json.error.code).toBe('ACCOUNT_DELETED');
    const created = await call(pedro, 'POST', '/v1/trips', { body: { name: 'X', startDate: '2026-11-01', endDate: '2026-11-02', currency: 'USD' } });
    expect(created.json.error.code).toBe('ACCOUNT_DELETED');
    const invited = await createTrip(juan, { name: 'Nuevo', inviteEmails: [pedro.email] });
    expect((await call(pedro, 'POST', `/v1/trips/${invited.id}/invitations/accept`)).json.error.code).toBe('ACCOUNT_DELETED');
  });

  it('repeating the request after completion is a no-op', async () => {
    const again = await deleteAccount(pedro);
    expect(again.status).toBe(200);
    expect(again.json.status).toBe('completed');
  });
});

describe('creator transfer and edge cases', () => {
  it('the oldest admin becomes creator; without admins, the oldest participant', async () => {
    const c1 = person('Carla');
    const t1 = await activeTrip(c1, [juan, luis]);
    await call(c1, 'PUT', `/v1/trips/${t1.id}/members/${luis.uid}/role`, { body: { role: 'admin', expectedVersion: t1.version } });
    const c2 = person('Dora');
    const t2 = await activeTrip(c2, [juan, luis]);

    expect((await deleteAccount(c1)).json.status).toBe('completed');
    expect((await members(luis, t1.id)).find((m) => m.key === luis.uid)!.role).toBe('creator');
    expect((await db.get(`users/${luis.uid}/trips/${t1.id}`))!.data['role']).toBe('creator');
    expect((await members(luis, t1.id)).find((m) => m.key === c1.uid)!.role).toBe('member');
    expect((await db.query(`trips/${t1.id}/auditEvents`, { where: [['action', '==', 'member.creator_transferred']] }))).toHaveLength(1);

    expect((await deleteAccount(c2)).json.status).toBe('completed');
    expect((await members(juan, t2.id)).find((m) => m.key === juan.uid)!.role).toBe('creator');
  });

  it('a lone creator keeps the role; two deleted members get labels 1 and 2; closed and archived trips are anonymized', async () => {
    const lone = person('Lone');
    const alone = await createTrip(lone, { name: 'Solo' });
    expect((await deleteAccount(lone)).json.status).toBe('completed');
    const loneRow = (await db.get(`trips/${alone.id}/members/${lone.uid}`))!.data;
    expect(loneRow).toMatchObject({ role: 'creator', displayName: 'Participante eliminado 1', email: '' });

    const a = person('Alfa');
    const b = person('Beta');
    const trip = await activeTrip(ana, [a, b]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, a.uid, b.uid], 3000));
    expect((await setStatus(ana, trip.id, 'close', await tripVersion(ana, trip.id))).status).toBe(200);
    expect((await deleteAccount(a)).json.status).toBe('completed');
    expect((await setStatus(ana, trip.id, 'archive', await tripVersion(ana, trip.id))).status).toBe(200);
    expect((await deleteAccount(b)).json.status).toBe('completed');
    const labels = (await members(ana, trip.id)).filter((m) => m.deletedAt).map((m) => m.displayName).sort();
    expect(labels).toEqual(['Participante eliminado 1', 'Participante eliminado 2']);
  });

  it('a deleted member cannot read the trip any more (API)', async () => {
    const x = person('Xavi');
    const trip = await activeTrip(ana, [x]);
    await deleteAccount(x);
    expect((await call(x, 'GET', `/v1/trips/${trip.id}`)).status).toBe(404);
    expect((await call(x, 'GET', `/v1/trips/${trip.id}/balances`)).status).toBe(404);
  });
});

describe('resumable and idempotent (FR-010)', () => {
  it('a failure after the first trip leaves the deletion in progress; a retry finishes it without duplicating labels', async () => {
    const p = person('Paco');
    const t1 = await activeTrip(ana, [p]);
    const t2 = await activeTrip(juan, [p]);
    deletionTestHooks.failAfterTrips = 1;
    const failed = await deleteAccount(p);
    expect(failed.status).toBe(500);
    expect((await db.get(`accountDeletions/${p.uid}`))!.data).toMatchObject({ status: 'in_progress' });
    expect((await db.get(`accountDeletions/${p.uid}`))!.data['pendingTripIds']).toHaveLength(1);

    deletionTestHooks.failAfterTrips = null;
    const done = await deleteAccount(p);
    expect(done.json.status).toBe('completed');
    for (const [u, t] of [[ana, t1], [juan, t2]] as const) {
      const labels = (await members(u, t.id)).filter((m) => m.deletedAt).map((m) => m.displayName);
      expect(labels).toEqual(['Participante eliminado 1']);
    }
  });

  it('the hourly job completes deletions left in progress', async () => {
    const p = person('Rosa');
    const t1 = await activeTrip(ana, [p]);
    await activeTrip(juan, [p]);
    deletionTestHooks.failAfterTrips = 1;
    expect((await deleteAccount(p)).status).toBe(500);
    deletionTestHooks.failAfterTrips = null;

    const resumed = await resumeDeletions(db, createStorageProvider(env), env, new Date());
    expect(resumed).toBe(1);
    expect((await db.get(`accountDeletions/${p.uid}`))!.data['status']).toBe('completed');
    expect((await members(ana, t1.id)).find((m) => m.key === p.uid)!.deletedAt).not.toBeNull();
    expect(await db.get(`users/${p.uid}`)).toBeNull();
  });
});

describe('SC-003: a user with 10 trips is deleted in under a minute', () => {
  it('completes the deletion of 10 trips with expenses in less than 60 s', async () => {
    const p = person('Viajera');
    const others = [juan, luis];
    for (let i = 0; i < 10; i++) {
      const trip = await activeTrip(p, others, { name: `Viaje ${i}` });
      await postExpense(p, trip.id, equalExpense(p.uid, [p.uid, juan.uid, luis.uid], 3000 + i));
    }
    const t0 = Date.now();
    const res = await deleteAccount(p);
    const ms = Date.now() - t0;
    console.log(JSON.stringify({ deletion10TripsMs: ms }));
    expect(res.json).toEqual({ status: 'completed', tripsProcessed: 10 });
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});
