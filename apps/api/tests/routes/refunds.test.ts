import { env } from 'cloudflare:workers';
import { rebuildLedger, type LedgerEffect } from 'finance-engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { rebuildProjections, type ExpenseForProjection, type RefundForProjection } from '../../src/services/projections.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, netOf, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, eve } = users;

beforeAll(clearFirestore);

function vinoBody(withTax = false) {
  return {
    description: 'Súper',
    transactionDate: '2026-11-02',
    categoryId: 'default-food',
    totalMinor: withTax ? 3300 : 3000,
    payers: [{ uid: ana.uid, amountMinor: withTax ? 3300 : 3000 }],
    splitMode: 'items',
    items: [{ id: 'vino', index: 0, grossMinor: 3000, quantity: 3, classification: 'shared', beneficiaries: [ana.uid, pedro.uid], allocation: { mode: 'equal' } }],
    adjustments: withTax ? [{ kind: 'tax', amountMinor: 300, mode: 'proportional' }] : [],
  };
}

const refund = (u: typeof ana, t: string, e: string, body: Record<string, unknown>, key = crypto.randomUUID()) =>
  call(u, 'POST', `/v1/trips/${t}/expenses/${e}/refunds`, { body, headers: { 'idempotency-key': key } });

describe('refunds (RF-37)', () => {
  it('quickstart: 1 of 3 units received by Pedro → charges −5.00 each, Pedro owes Ana 5.00 more; zero-sum', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = (await postExpense(ana, trip.id, vinoBody())).json.expense;
    expect(await netOf(ana, trip.id, ana.uid)).toBe(1500);
    const suggestion = await call(pedro, 'GET', `/v1/trips/${trip.id}/expenses/${e.id}/items/vino/refundable?quantity=1`);
    expect(suggestion.json).toMatchObject({ quantity: 3, refundedQuantity: 0, maxMinor: 3000, suggestedMinor: 1000 });

    const res = await refund(pedro, trip.id, e.id, { itemId: 'vino', quantity: 1, amountMinor: 1000, recipientUid: pedro.uid });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.refund).toMatchObject({ chargesDelta: { [ana.uid]: 500, [pedro.uid]: 500 }, recipientUid: pedro.uid });
    expect(await netOf(ana, trip.id, ana.uid)).toBe(2000);
    expect(await netOf(ana, trip.id, pedro.uid)).toBe(-2000);

    const doc = (await db.get(`trips/${trip.id}/expenses/${e.id}`))!.data;
    expect(doc['refundedByItem']).toEqual({ vino: { quantity: 1, amountMinor: 1000 } });
    expect(doc['totalMinor']).toBe(3000);
  });

  it('suggested amount includes the item share of general adjustments; REFUND_EXCEEDS with the max available', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = (await postExpense(ana, trip.id, vinoBody(true))).json.expense;
    const s = await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${e.id}/items/vino/refundable?quantity=1`);
    expect(s.json).toMatchObject({ maxMinor: 3300, suggestedMinor: 1100 });
    await refund(ana, trip.id, e.id, { itemId: 'vino', quantity: 1, amountMinor: 1100, recipientUid: ana.uid });
    const tooMany = await refund(ana, trip.id, e.id, { itemId: 'vino', quantity: 3, amountMinor: 100, recipientUid: ana.uid });
    expect(tooMany.status).toBe(422);
    expect(tooMany.json.error).toMatchObject({ code: 'REFUND_EXCEEDS', details: { maxQuantity: 2, maxMinor: 2200 } });
    const tooMuch = await refund(ana, trip.id, e.id, { itemId: 'vino', quantity: 0, amountMinor: 2201, recipientUid: ana.uid });
    expect(tooMuch.json.error.code).toBe('REFUND_EXCEEDS');
    expect((await call(ana, 'GET', `/v1/trips/${trip.id}/expenses/${e.id}/items/vino/refundable?quantity=2`)).json.suggestedMinor).toBe(2200);
  });

  it('permissions (Q3), recipient must be a member, voided expenses reject; idempotent', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const e = (await postExpense(ana, trip.id, vinoBody())).json.expense;
    const body = { itemId: 'vino', quantity: 1, amountMinor: 1000, recipientUid: pedro.uid };
    expect((await refund(juan, trip.id, e.id, body)).status).toBe(404);
    expect((await refund(ana, trip.id, e.id, { ...body, recipientUid: eve.uid })).status).toBe(422);
    expect((await refund(ana, trip.id, e.id, { ...body, itemId: 'nope' })).status).toBe(422);
    const key = crypto.randomUUID();
    const a = await refund(pedro, trip.id, e.id, body, key);
    const b = await refund(pedro, trip.id, e.id, body, key);
    expect(b.json.refund.id).toBe(a.json.refund.id);
    expect(await db.query(`trips/${trip.id}/expenses/${e.id}/refunds`)).toHaveLength(1);
    await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${e.id}/void`, { body: { expectedVersion: 2 } });
    expect((await refund(ana, trip.id, e.id, { ...body, amountMinor: 10 })).json.error.code).toBe('INVALID_TRANSITION');
  });

  it('void and restore of the parent remove and re-add refund effects; projections equal a rebuild', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = (await postExpense(ana, trip.id, vinoBody())).json.expense;
    await refund(pedro, trip.id, e.id, { itemId: 'vino', quantity: 1, amountMinor: 1000, recipientUid: pedro.uid });
    await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${e.id}/void`, { body: { expectedVersion: 2 } });
    expect(await netOf(ana, trip.id, ana.uid)).toBe(0);
    expect((await db.get(`trips/${trip.id}/projections/public`))!.data).toMatchObject({ sharedTotalMinor: 0, expenseCount: 0 });
    await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${e.id}/restore`, { body: { expectedVersion: 3 } });
    expect(await netOf(ana, trip.id, ana.uid)).toBe(2000);

    const doc = (await db.get(`trips/${trip.id}/expenses/${e.id}`))!.data;
    const refunds = await db.query(`trips/${trip.id}/expenses/${e.id}/refunds`);
    const ledger = (await db.get(`trips/${trip.id}/projections/ledger`))!.data;
    expect(ledger['netByMember']).toEqual(
      rebuildLedger([doc['ledgerEffect'] as LedgerEffect, ...refunds.map((r) => r.data['ledgerEffect'] as LedgerEffect)], []).netByMember,
    );
    const rebuilt = rebuildProjections(
      [doc as unknown as ExpenseForProjection],
      refunds.map((r) => ({ ...(r.data as unknown as RefundForProjection), categoryId: 'default-food', viewerUids: doc['viewerUids'] as string[] })),
    );
    expect((await db.get(`trips/${trip.id}/projections/public`))!.data).toMatchObject(rebuilt.public);
  });

  it('edits cannot drop an item below what was refunded (REFUND_CONSTRAINT)', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = (await postExpense(ana, trip.id, vinoBody())).json.expense;
    await refund(ana, trip.id, e.id, { itemId: 'vino', quantity: 2, amountMinor: 2000, recipientUid: ana.uid });
    const lowerQty = { ...vinoBody(), items: [{ ...vinoBody().items[0], quantity: 1 }], expectedVersion: 2 };
    expect((await call(ana, 'PUT', `/v1/trips/${trip.id}/expenses/${e.id}`, { body: lowerQty })).json.error.code).toBe('REFUND_CONSTRAINT');
    const removed = { ...vinoBody(), items: [{ ...vinoBody().items[0], id: 'otro' }], expectedVersion: 2 };
    expect((await call(ana, 'PUT', `/v1/trips/${trip.id}/expenses/${e.id}`, { body: removed })).json.error.code).toBe('REFUND_CONSTRAINT');
    const ok = { ...vinoBody(), description: 'Súper editado', expectedVersion: 2 };
    expect((await call(ana, 'PUT', `/v1/trips/${trip.id}/expenses/${e.id}`, { body: ok })).status).toBe(200);
  });
});
