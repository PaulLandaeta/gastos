import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

const cena = (payer: string, beneficiaries: string[], date = '2026-11-01', total = 4500) => ({
  ...equalExpense(payer, beneficiaries, total),
  transactionDate: date,
});

describe('possible duplicates (RF-22)', () => {
  it('warns with the similar expense when visible, saves after confirmation', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const first = await postExpense(ana, trip.id, cena(ana.uid, [ana.uid, pedro.uid]));
    const dup = await postExpense(ana, trip.id, cena(ana.uid, [ana.uid, juan.uid]));
    expect(dup.status).toBe(409);
    expect(dup.json.error).toMatchObject({
      code: 'POSSIBLE_DUPLICATE',
      details: { similar: { id: first.json.expense.id, description: 'Cena', transactionDate: '2026-11-01', totalMinor: 4500 } },
    });
    const confirmed = await postExpense(ana, trip.id, { ...cena(ana.uid, [ana.uid, juan.uid]), confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
    const doc = await db.get(`trips/${trip.id}/expenses/${confirmed.json.expense.id}`);
    expect(doc?.data['duplicateConfirmed']).toBe(true);
  });

  it('does not reveal a similar expense the caller cannot see', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await postExpense(pedro, trip.id, cena(pedro.uid, [pedro.uid]));
    // Juan registers an expense paid by Pedro for himself: same payer/date/total, but Juan cannot see Pedro's.
    const dup = await postExpense(juan, trip.id, cena(pedro.uid, [juan.uid]));
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('POSSIBLE_DUPLICATE');
    expect(dup.json.error.details ?? {}).toEqual({});
  });

  it('retrying with the same idempotency key replays without a warning', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const key = crypto.randomUUID();
    const a = await postExpense(ana, trip.id, cena(ana.uid, [ana.uid, pedro.uid]), key);
    const b = await postExpense(ana, trip.id, cena(ana.uid, [ana.uid, pedro.uid]), key);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.json.expense.id).toBe(a.json.expense.id);
  });

  it('no warning when date, total or payers differ, nor against voided expenses', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const first = await postExpense(ana, trip.id, cena(ana.uid, [ana.uid, pedro.uid]));
    expect((await postExpense(ana, trip.id, cena(ana.uid, [ana.uid], '2026-11-02'))).status).toBe(201);
    expect((await postExpense(ana, trip.id, cena(ana.uid, [ana.uid], '2026-11-01', 4501))).status).toBe(201);
    expect((await postExpense(pedro, trip.id, cena(pedro.uid, [pedro.uid]))).status).toBe(201);
    await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${first.json.expense.id}/void`, { body: { expectedVersion: 1 } });
    // Only Pedro's (different payer) and voided Ana's remain on that date/total → no warning for Ana.
    expect((await postExpense(ana, trip.id, cena(ana.uid, [ana.uid]))).status).toBe(201);
  });
});
