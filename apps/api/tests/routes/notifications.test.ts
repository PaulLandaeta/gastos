import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip, equalExpense, postExpense, setStatus } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis, eve } = users;

beforeAll(clearFirestore);

type N = { id: string; type: string; title: string; body: string | null; link: string; tripId: string; readAt: Date | null };

async function inbox(uid: string, tripId?: string): Promise<N[]> {
  const docs = await db.query(`users/${uid}/notifications`);
  return docs
    .map((d) => ({ id: d.id, ...(d.data as Omit<N, 'id'>) }))
    .filter((n) => !tripId || n.tripId === tripId);
}

const types = (ns: N[]) => ns.map((n) => n.type).sort();

describe('notifications generated with each action (US3, FR-010/FR-011)', () => {
  it('expense lifecycle: only participants, never the author, never a non-involved member', async () => {
    const trip = await activeTrip(ana, [juan, pedro]);
    const created = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 3000));
    expect(created.status).toBe(201);
    const expenseId = created.json.expense.id as string;

    const juanBox = await inbox(juan.uid, trip.id);
    expect(juanBox).toHaveLength(1);
    expect(juanBox[0]).toMatchObject({ type: 'expense.created', link: `/trips/${trip.id}/expenses/${expenseId}`, readAt: null });
    expect(juanBox[0]!.body).toContain('Cena');
    expect(await inbox(pedro.uid, trip.id)).toEqual([]); // RF-38: Pedro does not even learn it exists
    expect(await inbox(ana.uid, trip.id)).toEqual([]);

    // Edit that only renames: nobody's share changes → no notification.
    const rename = await call(ana, 'PUT', `/v1/trips/${trip.id}/expenses/${expenseId}`, {
      body: { ...equalExpense(ana.uid, [ana.uid, juan.uid], 3000), description: 'Cena larga', expectedVersion: 1 },
    });
    expect(rename.status, JSON.stringify(rename.json)).toBe(200);
    expect(await inbox(juan.uid, trip.id)).toHaveLength(1);

    // Edit that swaps Juan for Pedro: Juan learns only that he is out; Pedro gets the details.
    const swap = await call(ana, 'PUT', `/v1/trips/${trip.id}/expenses/${expenseId}`, {
      body: { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 3000), description: 'Cena larga', expectedVersion: 2 },
    });
    expect(swap.status).toBe(200);
    const removed = (await inbox(juan.uid, trip.id)).find((n) => n.type === 'expense.removed_from')!;
    expect(removed.body).toBeNull();
    expect(JSON.stringify(removed)).not.toContain('Cena');
    expect(types(await inbox(pedro.uid, trip.id))).toEqual(['expense.updated']);

    // Void and restore reach the current participants.
    expect((await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${expenseId}/void`, { body: { expectedVersion: 3 } })).status).toBe(200);
    expect((await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${expenseId}/restore`, { body: { expectedVersion: 4 } })).status).toBe(200);
    expect(types(await inbox(pedro.uid, trip.id))).toEqual(['expense.restored', 'expense.updated', 'expense.voided']);
    expect(types(await inbox(juan.uid, trip.id))).toEqual(['expense.created', 'expense.removed_from']);
  });

  it('a failed action leaves no notifications (same transaction)', async () => {
    const trip = await activeTrip(ana, [juan]);
    const bad = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, juan.uid]), categoryId: 'no-such-category' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(await inbox(juan.uid, trip.id)).toEqual([]);
  });

  it('payments: pending to the receiver, confirmed/rejected to the emitter', async () => {
    const trip = await activeTrip(ana, [juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 2000));
    const pay = (amountMinor: number) =>
      call(juan, 'POST', `/v1/trips/${trip.id}/settlements`, { body: { toUid: ana.uid, amountMinor }, headers: { 'idempotency-key': crypto.randomUUID() } });
    const s1 = (await pay(500)).json.settlement;
    const s2 = (await pay(700)).json.settlement;
    expect(types(await inbox(ana.uid, trip.id))).toEqual(['settlement.pending', 'settlement.pending']);
    await call(ana, 'POST', `/v1/trips/${trip.id}/settlements/${s1.id}/confirm`, { body: { expectedVersion: 1 } });
    await call(ana, 'POST', `/v1/trips/${trip.id}/settlements/${s2.id}/reject`, { body: { expectedVersion: 1 } });
    const juanBox = await inbox(juan.uid, trip.id);
    expect(types(juanBox)).toEqual(['expense.created', 'settlement.confirmed', 'settlement.rejected']);
  });

  it('refund: the recipient is told; details only if they can see the expense', async () => {
    const trip = await activeTrip(ana, [juan, pedro]);
    const e = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 2000, ), crypto.randomUUID());
    const res = await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/refunds`, {
      body: { itemId: 't', quantity: 0, amountMinor: 400, recipientUid: pedro.uid },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const [n] = await inbox(pedro.uid, trip.id);
    expect(n).toMatchObject({ type: 'refund.received', link: `/trips/${trip.id}` });
    expect(n!.body).not.toContain('Cena');
  });

  it('trip status changes reach the other members without financial data', async () => {
    const trip = await activeTrip(ana, [juan, pedro]);
    expect((await setStatus(ana, trip.id, 'close', trip.version)).status).toBe(200);
    for (const u of [juan, pedro]) {
      const [n] = await inbox(u.uid, trip.id);
      expect(n).toMatchObject({ type: 'trip.status_changed', body: null });
    }
    expect(await inbox(ana.uid, trip.id)).toEqual([]);
  });

  it('invitations notify invitees who already have an account', async () => {
    expect((await call(luis, 'POST', '/v1/me/sync')).status).toBe(200);
    const trip = await createTrip(ana, { inviteEmails: [luis.email, eve.email] });
    const [n] = await inbox(luis.uid, trip.id);
    expect(n).toMatchObject({ type: 'invitation.received', link: '/' });
    expect(await inbox(eve.uid, trip.id)).toEqual([]); // no account yet: sees it in the invitations inbox
  });
});

describe('read / unread (FR-012)', () => {
  it('marks only the caller’s own notifications', async () => {
    const trip = await activeTrip(ana, [juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 1111));
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 2222));
    const [first, second] = await inbox(juan.uid, trip.id);

    // Someone else cannot touch Juan's notifications.
    const foreign = await call(ana, 'POST', '/v1/me/notifications/read', { body: { ids: [first!.id] } });
    expect(foreign.json).toEqual({ updated: 0 });

    expect((await call(juan, 'POST', '/v1/me/notifications/read', { body: { ids: [first!.id, 'missing'] } })).json).toEqual({ updated: 1 });
    expect((await inbox(juan.uid, trip.id)).find((n) => n.id === first!.id)!.readAt).toBeInstanceOf(Date);

    expect((await call(juan, 'POST', '/v1/me/notifications/unread', { body: { ids: [first!.id] } })).json).toEqual({ updated: 1 });
    expect((await inbox(juan.uid, trip.id)).find((n) => n.id === first!.id)!.readAt).toBeNull();

    const all = await call(juan, 'POST', '/v1/me/notifications/read', { body: { all: true } });
    expect(all.json.updated).toBeGreaterThanOrEqual(2);
    expect((await inbox(juan.uid)).every((n) => n.readAt !== null)).toBe(true);
    expect(second).toBeDefined();
  });

  it('validates the body', async () => {
    expect((await call(juan, 'POST', '/v1/me/notifications/read', { body: { ids: [] } })).status).toBe(422);
    expect((await call(juan, 'POST', '/v1/me/notifications/unread', { body: { all: true } })).status).toBe(422);
    expect((await call(null, 'POST', '/v1/me/notifications/read', { body: { all: true } })).status).toBe(401);
  });
});
