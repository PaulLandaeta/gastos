import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense, tripVersion } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis } = users;

beforeAll(clearFirestore);

const voidExpense = (user: typeof ana, tripId: string, expenseId: string, expectedVersion = 1) =>
  call(user, 'POST', `/v1/trips/${tripId}/expenses/${expenseId}/void`, { body: { expectedVersion } });

describe('POST /v1/trips/{id}/expenses/{expenseId}/void', () => {
  it('Scenario: moneda congelada — tras anular el primer gasto, USD→BOB y nuevas invitaciones se rechazan', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const created = await postExpense(pedro, trip.id, equalExpense(pedro.uid, [ana.uid, pedro.uid]));
    const voided = await voidExpense(pedro, trip.id, created.json.expense.id);
    expect(voided.status).toBe(200);
    expect(voided.json.expense.status).toBe('voided');

    const ledger = await db.get(`trips/${trip.id}/projections/ledger`);
    expect(ledger?.data['netByMember']).toEqual({});

    const v = await tripVersion(ana, trip.id);
    const currency = await call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: v, currency: 'BOB' } });
    expect(currency.status).toBe(409);
    expect(currency.json.error.code).toBe('CURRENCY_LOCKED');
    const invite = await call(ana, 'POST', `/v1/trips/${trip.id}/invitations`, { body: { expectedVersion: v, emails: [luis.email] } });
    expect(invite.json.error.code).toBe('PARTICIPANTS_LOCKED');
  });

  it('the author, the creator and admins can void; other members cannot', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const byPedro = await postExpense(pedro, trip.id, equalExpense(pedro.uid, [pedro.uid, juan.uid]));
    expect((await voidExpense(juan, trip.id, byPedro.json.expense.id)).status).toBe(403);
    expect((await voidExpense(ana, trip.id, byPedro.json.expense.id)).status).toBe(200);

    const v = await tripVersion(ana, trip.id);
    await call(ana, 'PUT', `/v1/trips/${trip.id}/members/${juan.uid}/role`, { body: { expectedVersion: v, role: 'admin' } });
    const byAna = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid]));
    expect((await voidExpense(juan, trip.id, byAna.json.expense.id)).status).toBe(200);
  });

  it('voiding twice → INVALID_TRANSITION; stale version → CONFLICT; unknown → 404', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid]));
    expect((await voidExpense(ana, trip.id, e.json.expense.id, 7)).json.error.code).toBe('CONFLICT');
    await voidExpense(ana, trip.id, e.json.expense.id);
    expect((await voidExpense(ana, trip.id, e.json.expense.id, 2)).json.error.code).toBe('INVALID_TRANSITION');
    expect((await voidExpense(ana, trip.id, 'nope')).status).toBe(404);
  });
});
