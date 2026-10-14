import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, eve } = users;

beforeAll(clearFirestore);

const exportOf = (u: typeof ana, tripId: string, query = 'format=xlsx') => call(u, 'GET', `/v1/trips/${tripId}/export?${query}`);

async function allPages(u: typeof ana, tripId: string) {
  const pages = [];
  let res = await exportOf(u, tripId);
  pages.push(res);
  while (res.status === 200 && res.json.nextCursor) {
    res = await exportOf(u, tripId, `format=xlsx&cursor=${encodeURIComponent(res.json.nextCursor)}`);
    pages.push(res);
  }
  return pages;
}

/** Writes `count` expense documents directly (enough fields for the export), in commits of 450. */
async function seedExpenses(tripId: string, uid: string, count: number) {
  await db.runTransaction(async (tx) => {
    for (let i = 1; i <= count; i++) {
      tx.set(`trips/${tripId}/expenses/seed${String(i).padStart(4, '0')}`, {
        seq: i,
        description: `Gasto ${i}`,
        transactionDate: '2026-11-02',
        categoryId: 'default-food',
        totalMinor: 100,
        sharedTotalMinor: 100,
        personalTotalMinor: 0,
        payers: [{ uid, amountMinor: 100 }],
        chargesByMember: { [uid]: { sharedMinor: 100, personalMinor: 0, netMinor: 100 } },
        items: [{ id: 'i', grossMinor: 100, classification: 'shared', beneficiaries: [uid] }],
        adjustments: [],
        viewerUids: [uid],
        status: 'active',
        createdAt: new Date(),
      });
    }
  });
}

describe('GET /trips/{t}/export (US4, RF-19)', () => {
  it('pages of ≤ 100 with the header and the audit event only on the first one', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await seedExpenses(trip.id, ana.uid, 450);
    const pages = await allPages(ana, trip.id);
    expect(pages.map((p) => p.status)).toEqual([200, 200, 200, 200, 200]);
    expect(pages.map((p) => p.json.expenses.length)).toEqual([100, 100, 100, 100, 50]);
    expect(pages.map((p) => p.json.header !== undefined)).toEqual([true, false, false, false, false]);
    expect(pages[0]!.headers.get('cache-control')).toBe('no-store');
    const seqs = pages.flatMap((p) => p.json.expenses.map((e: { seq: number }) => e.seq));
    expect(seqs).toEqual(Array.from({ length: 450 }, (_, i) => i + 1)); // no gaps, no duplicates
    const audits = (await db.query(`trips/${trip.id}/auditEvents`)).filter((a) => a.data['action'] === 'trip.exported');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data).toMatchObject({ actorUid: ana.uid, redactedDiff: { format: 'xlsx', scope: 'all' } });
  });

  it('rejects foreign or tampered cursors and unknown formats', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await seedExpenses(trip.id, ana.uid, 101);
    const first = await exportOf(ana, trip.id);
    const cursor = first.json.nextCursor as string;
    expect((await exportOf(pedro, trip.id, `format=xlsx&cursor=${encodeURIComponent(cursor)}`)).status).toBe(422);
    expect((await exportOf(ana, trip.id, 'format=xlsx&cursor=garbage')).status).toBe(422);
    expect((await exportOf(ana, trip.id, 'format=csv')).status).toBe(422);
  });

  it('privacy: a participant exports only visible expenses, but every balance (SC-008)', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const privateOne = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, juan.uid], 3000), description: 'Regalo sorpresa' });
    const shared = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid], 900), description: 'Taxi' });
    expect([privateOne.status, shared.status]).toEqual([201, 201]);

    const [p] = await allPages(pedro, trip.id);
    const body = p!.json;
    expect(body.expenses.map((e: { description: string }) => e.description)).toEqual(['Taxi']);
    expect(JSON.stringify(body)).not.toContain('Regalo');
    expect(body.header.scope).toBe('visible');

    // Balances match the app, and others' paid/consumed are hidden (FR-026).
    const balances = (await call(pedro, 'GET', `/v1/trips/${trip.id}/balances?view=original`)).json;
    const net = Object.fromEntries(body.header.balances.map((b: { uid: string; netMinor: number }) => [b.uid, b.netMinor]));
    for (const m of balances.netByMember) expect(net[m.uid]).toBe(m.netMinor);
    expect(Object.values(net).reduce((a: number, b) => a + (b as number), 0)).toBe(0);
    expect(body.header.debts.original).toEqual(balances.transfers);
    const simplified = (await call(pedro, 'GET', `/v1/trips/${trip.id}/balances?view=simplified`)).json;
    expect(body.header.debts.simplified).toEqual(simplified.transfers);
    const others = body.header.balances.filter((b: { uid: string }) => b.uid !== pedro.uid);
    expect(others.every((b: { paidMinor: unknown; consumedMinor: unknown }) => b.paidMinor === null && b.consumedMinor === null)).toBe(true);
    expect(body.header.balances.find((b: { uid: string }) => b.uid === pedro.uid)).toMatchObject({ paidMinor: 0, consumedMinor: 300 });

    // The creator exports everything.
    const [a] = await allPages(ana, trip.id);
    expect(a!.json.header.scope).toBe('all');
    expect(a!.json.expenses.map((e: { description: string }) => e.description).sort()).toEqual(['Regalo sorpresa', 'Taxi']);
    expect(a!.json.header.balances.every((b: { paidMinor: unknown }) => b.paidMinor !== null)).toBe(true);
  });

  it('voided expenses are listed apart; closed trips export; non-members get 404', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 500));
    await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/void`, { body: { expectedVersion: 1 } });
    const current = (await call(ana, 'GET', `/v1/trips/${trip.id}`)).json.trip;
    expect((await call(ana, 'POST', `/v1/trips/${trip.id}/status`, { body: { expectedVersion: current.version, action: 'close' } })).status).toBe(200);

    const [p] = await allPages(pedro, trip.id);
    expect(p!.json.expenses).toEqual([]);
    expect(p!.json.voidedExpenses).toHaveLength(1);
    expect(p!.json.header.trip.status).toBe('closed');

    expect((await exportOf(eve, trip.id)).status).toBe(404);
    const pending = await createTrip(ana, { inviteEmails: [eve.email] });
    expect((await exportOf(eve, pending.id)).status).toBe(404);
  });

  it('refunds of visible expenses come with their page', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const e = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1200));
    const hidden = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 1500));
    for (const exp of [e, hidden]) {
      const r = await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${exp.json.expense.id}/refunds`, {
        body: { itemId: 't', quantity: 0, amountMinor: 100, recipientUid: ana.uid },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(r.status).toBe(201);
    }
    const [p] = await allPages(pedro, trip.id);
    expect(p!.json.refunds.map((r: { expenseId: string }) => r.expenseId)).toEqual([e.json.expense.id]);
  });
});
