import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, createTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

function mixedInvoice(categoryId = 'default-food') {
  return {
    description: 'Súper',
    transactionDate: '2026-11-02',
    categoryId,
    notes: 'ticket 123',
    servicePeriod: null,
    totalMinor: 2310,
    payers: [
      { uid: pedro.uid, amountMinor: 1500 },
      { uid: ana.uid, amountMinor: 810 },
    ],
    splitMode: 'items',
    items: [
      { id: 'pan', index: 0, grossMinor: 600, classification: 'shared', beneficiaries: [ana.uid, pedro.uid], allocation: { mode: 'equal' } },
      { id: 'agua', index: 1, grossMinor: 300, classification: 'shared', beneficiaries: [ana.uid, pedro.uid], allocation: { mode: 'equal' } },
      { id: 'champu', index: 2, grossMinor: 1200, classification: 'personal', beneficiaries: [ana.uid], allocation: { mode: 'equal' } },
    ],
    adjustments: [{ kind: 'tax', amountMinor: 210, mode: 'proportional' }],
  };
}

describe('expense v2', () => {
  it('createTrip seeds the 6 default categories', async () => {
    const trip = await createTrip(ana);
    const cats = await db.query(`trips/${trip.id}/categories`);
    expect(cats.map((c) => c.id).sort()).toEqual(
      ['default-activities', 'default-food', 'default-lodging', 'default-other', 'default-shopping', 'default-transport'],
    );
    expect(cats.every((c) => c.data['active'] === true && c.data['isDefault'] === true)).toBe(true);
  });

  it('stores derived visibility fields, shared/personal totals and v2 metadata', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const res = await postExpense(juan, trip.id, mixedInvoice());
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.expense.chargesByMember[ana.uid]).toMatchObject({ personalMinor: expect.any(Number) });
    const doc = await db.get(`trips/${trip.id}/expenses/${res.json.expense.id}`);
    const e = doc!.data;
    expect(e).toMatchObject({
      categoryId: 'default-food',
      notes: 'ticket 123',
      schemaVersion: 2,
      createdBy: juan.uid,
      payerUids: [ana.uid, pedro.uid].sort(),
      beneficiaryUids: [ana.uid, pedro.uid].sort(),
      personalBeneficiaryUids: [ana.uid],
      viewerUids: [ana.uid, juan.uid, pedro.uid].sort(),
    });
    expect((e['sharedTotalMinor'] as number) + (e['personalTotalMinor'] as number)).toBe(2310);
    expect(e['personalTotalMinor']).toBeGreaterThanOrEqual(1200);
    expect(e['recordedAt']).toBeInstanceOf(Date);
  });

  it('stores the optional service period (multi-day service as a single expense)', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const body = { ...equalExpense(ana.uid, [ana.uid, pedro.uid], 30000), servicePeriod: { startDate: '2026-11-01', endDate: '2026-11-03' } };
    const res = await postExpense(ana, trip.id, body);
    expect(res.status).toBe(201);
    const doc = await db.get(`trips/${trip.id}/expenses/${res.json.expense.id}`);
    expect(doc!.data['servicePeriod']).toEqual({ startDate: '2026-11-01', endDate: '2026-11-03' });
  });

  it('rejects unknown or inactive categories with CATEGORY_INACTIVE', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const unknown = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid]), categoryId: 'nope' });
    expect(unknown.json.error.code).toBe('CATEGORY_INACTIVE');
    await db.runTransaction(async (tx) => tx.update(`trips/${trip.id}/categories/default-shopping`, { active: false }));
    const inactive = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid]), categoryId: 'default-shopping' });
    expect(inactive.json.error.code).toBe('CATEGORY_INACTIVE');
  });

  it('lazily seeds default categories on trips that have none (created before feature 002)', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const cats = await db.query(`trips/${trip.id}/categories`);
    await db.runTransaction(async (tx) => cats.forEach((c) => tx.delete(c.path)));
    const res = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid]));
    expect(res.status).toBe(201);
    expect((await db.query(`trips/${trip.id}/categories`)).length).toBe(6);
  });

  it('a pending trip still answers TRIP_NOT_READY before any category check', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
    const res = await call(ana, 'POST', `/v1/trips/${trip.id}/expenses`, {
      body: { ...equalExpense(ana.uid, [ana.uid]), categoryId: 'nope' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(res.json.error.code).toBe('TRIP_NOT_READY');
  });
});
