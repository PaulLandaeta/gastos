import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { accept, activeTrip, createTrip, equalExpense, postExpense, setStatus } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis, eve } = users;

beforeAll(clearFirestore);

describe('POST /v1/trips/{id}/expenses', () => {
  it('Scenario: todos deben aceptar antes del primer gasto → TRIP_NOT_READY', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email, juan.email, luis.email, eve.email] });
    for (const u of [pedro, juan, luis]) await accept(u, trip.id);
    const res = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid]));
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('TRIP_NOT_READY');
  });

  it('non-members get 404; missing Idempotency-Key → 422', async () => {
    const trip = await activeTrip(ana, [pedro]);
    expect((await postExpense(eve, trip.id, equalExpense(ana.uid, [ana.uid]))).status).toBe(404);
    const noKey = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid]), null);
    expect(noKey.status).toBe(422);
    expect(noKey.json.error.code).toBe('VALIDATION_FAILED');
  });

  it('maps engine errors (NOT_RECONCILED, PAYER_NOT_MEMBER)', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const bad = { ...equalExpense(ana.uid, [ana.uid, pedro.uid]), totalMinor: 999 };
    const res = await postExpense(ana, trip.id, bad);
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('NOT_RECONCILED');
    const stranger = await postExpense(ana, trip.id, equalExpense(eve.uid, [ana.uid]));
    expect(stranger.json.error.code).toBe('PAYER_NOT_MEMBER');
  });

  it('the first expense gets seq 1, locks currency and participants, updates the ledger and audit', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const res = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid, juan.uid]));
    expect(res.status).toBe(201);
    expect(res.json.expense).toMatchObject({ seq: 1, totalMinor: 1000, status: 'active' });
    expect(res.json.trip).toMatchObject({ participantsLocked: true, currencyLocked: true, expenseSeq: 1 });
    expect(res.json.trip.firstExpenseAt).toBeTruthy();

    const second = await postExpense(pedro, trip.id, equalExpense(pedro.uid, [pedro.uid, juan.uid], 500));
    expect(second.json.expense.seq).toBe(2);

    const ledger = await db.get(`trips/${trip.id}/projections/ledger`);
    expect(ledger?.data['netByMember']).toEqual({ [ana.uid]: 666, [pedro.uid]: -83, [juan.uid]: -583 });
    const audit = await db.query(`trips/${trip.id}/auditEvents`, { where: [['action', '==', 'expense.create']] });
    expect(audit).toHaveLength(2);
  });

  it('the same Idempotency-Key creates exactly one expense and replays the response', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const key = crypto.randomUUID();
    const body = equalExpense(ana.uid, [ana.uid, pedro.uid]);
    const first = await postExpense(ana, trip.id, body, key);
    const again = await postExpense(ana, trip.id, body, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.json.expense.id).toBe(first.json.expense.id);
    const expenses = await db.query(`trips/${trip.id}/expenses`);
    expect(expenses).toHaveLength(1);
  });

  it('closed and archived trips reject expenses with TRIP_READ_ONLY', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const closed = await setStatus(ana, trip.id, 'close', trip.version);
    expect(closed.status).toBe(200);
    const res = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid]));
    expect(res.json.error.code).toBe('TRIP_READ_ONLY');
  });

  it('an unauthenticated request has no side effects', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const res = await call(null, 'POST', `/v1/trips/${trip.id}/expenses`, {
      body: equalExpense(ana.uid, [ana.uid]),
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(res.status).toBe(401);
    expect(await db.query(`trips/${trip.id}/expenses`)).toHaveLength(0);
    expect((await db.get(`trips/${trip.id}`))?.data['participantsLocked']).toBe(false);
  });
});
