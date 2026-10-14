import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, anaOwesPedro, equalExpense, pay, postExpense, resolveSettlement } from '../helpers/trips.js';

const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

async function tripWithConfirmedPayment() {
  const trip = await activeTrip(ana, [pedro, juan]);
  await anaOwesPedro(trip.id, ana, pedro, 2000);
  const s = (await pay(ana, trip.id, pedro.uid, 500)).json.settlement;
  await resolveSettlement(pedro, trip.id, s.id, 'confirm');
  const e = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid], 1000));
  return { tripId: trip.id, expenseId: e.json.expense.id as string };
}

const preview = (user: typeof ana, tripId: string, id: string, body: unknown) =>
  call(user, 'POST', `/v1/trips/${tripId}/expenses/${id}/preview`, { body });

describe('impact preview (RF-28)', () => {
  it('returns before/after/delta for void and edit, with the ledger revision', async () => {
    const { tripId, expenseId } = await tripWithConfirmedPayment();
    const v = await preview(ana, tripId, expenseId, { action: 'void' });
    expect(v.status).toBe(200);
    expect(v.json.requiresConfirmation).toBe(true);
    expect(typeof v.json.ledgerRevision).toBe('number');
    const delta = Object.fromEntries(v.json.delta.map((d: { uid: string; netMinor: number }) => [d.uid, d.netMinor]));
    expect(delta).toEqual({ [ana.uid]: -500, [pedro.uid]: 0, [juan.uid]: 500 });

    const edit = await preview(ana, tripId, expenseId, { action: 'edit', body: equalExpense(ana.uid, [ana.uid, juan.uid], 2000) });
    const after = Object.fromEntries(edit.json.after.map((d: { uid: string; netMinor: number }) => [d.uid, d.netMinor]));
    const before = Object.fromEntries(edit.json.before.map((d: { uid: string; netMinor: number }) => [d.uid, d.netMinor]));
    expect(after[juan.uid] - before[juan.uid]).toBe(-500);
  });

  it('non-viewers get 404', async () => {
    const { tripId, expenseId } = await tripWithConfirmedPayment();
    expect((await preview(pedro, tripId, expenseId, { action: 'void' })).status).toBe(404);
  });

  it('with confirmed payments, mutations require the acknowledged revision; stale revision → CONFLICT', async () => {
    const { tripId, expenseId } = await tripWithConfirmedPayment();
    const noRev = await call(ana, 'POST', `/v1/trips/${tripId}/expenses/${expenseId}/void`, { body: { expectedVersion: 1 } });
    expect(noRev.status).toBe(409);
    expect(noRev.json.error.code).toBe('PREVIEW_REQUIRED');
    expect(noRev.json.error.details.preview.after).toHaveLength(3);
    const rev = noRev.json.error.details.preview.ledgerRevision as number;

    const editNoRev = await call(ana, 'PUT', `/v1/trips/${tripId}/expenses/${expenseId}`, {
      body: { ...equalExpense(ana.uid, [ana.uid, juan.uid], 1200), expectedVersion: 1 },
    });
    expect(editNoRev.json.error.code).toBe('PREVIEW_REQUIRED');

    const stale = await call(ana, 'POST', `/v1/trips/${tripId}/expenses/${expenseId}/void`, {
      body: { expectedVersion: 1, expectedLedgerRevision: rev - 1 },
    });
    expect(stale.json.error.code).toBe('CONFLICT');
    const ok = await call(ana, 'POST', `/v1/trips/${tripId}/expenses/${expenseId}/void`, {
      body: { expectedVersion: 1, expectedLedgerRevision: rev },
    });
    expect(ok.status).toBe(200);
  });

  it('without confirmed payments the revision is optional', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const e = await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid], 1000));
    const p = await preview(ana, trip.id, e.json.expense.id, { action: 'void' });
    expect(p.json.requiresConfirmation).toBe(false);
    const res = await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${e.json.expense.id}/void`, { body: { expectedVersion: 1 } });
    expect(res.status).toBe(200);
  });
});
