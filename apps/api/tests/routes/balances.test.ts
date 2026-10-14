import { env } from 'cloudflare:workers';
import { rebuildLedger, type LedgerEffect } from 'finance-engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, eve } = users;

beforeAll(clearFirestore);

const balances = (user: typeof ana, tripId: string, view: string) =>
  call(user, 'GET', `/v1/trips/${tripId}/balances?view=${view}`);

describe('GET /v1/trips/{id}/balances', () => {
  it('Scenario: USD 10.00 entre 3 pagado por la creadora → +6.66 / −3.33 / −3.33', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid]));
    const res = await balances(juan, trip.id, 'original');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      currency: 'USD',
      view: 'original',
      netByMember: [
        { uid: ana.uid, netMinor: 666 },
        { uid: pedro.uid, netMinor: -333 },
        { uid: juan.uid, netMinor: -333 },
      ],
      transfers: [
        { fromUid: pedro.uid, toUid: ana.uid, amountMinor: 333 },
        { fromUid: juan.uid, toUid: ana.uid, amountMinor: 333 },
      ],
    });
  });

  it('both views share the same net balances and the projection equals a full rebuild', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid], 9000));
    await postExpense(pedro, trip.id, equalExpense(pedro.uid, [ana.uid, juan.uid], 3001));
    const voided = await postExpense(juan, trip.id, equalExpense(juan.uid, [ana.uid, pedro.uid], 777));
    await call(juan, 'POST', `/v1/trips/${trip.id}/expenses/${voided.json.expense.id}/void`, { body: { expectedVersion: 1 } });

    const original = await balances(ana, trip.id, 'original');
    const simplified = await balances(ana, trip.id, 'simplified');
    expect(simplified.json.netByMember).toEqual(original.json.netByMember);
    expect(simplified.json.transfers.length).toBeLessThanOrEqual(original.json.transfers.length);

    const expenses = await db.query(`trips/${trip.id}/expenses`, { where: [['status', '==', 'active']] });
    const rebuilt = rebuildLedger(expenses.map((e) => e.data['ledgerEffect'] as LedgerEffect), []);
    const projection = await db.get(`trips/${trip.id}/projections/ledger`);
    expect(projection?.data['netByMember']).toEqual(rebuilt.netByMember);
    expect(projection?.data['pairwise']).toEqual(rebuilt.pairwise);
  });

  it('returns zeros for a trip without expenses and 404 for non-members', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const res = await balances(pedro, trip.id, 'simplified');
    expect(res.json.netByMember).toEqual([
      { uid: ana.uid, netMinor: 0 },
      { uid: pedro.uid, netMinor: 0 },
    ]);
    expect(res.json.transfers).toEqual([]);
    expect((await balances(eve, trip.id, 'simplified')).status).toBe(404);
    expect((await balances(ana, trip.id, 'weird')).status).toBe(422);
  });
});
