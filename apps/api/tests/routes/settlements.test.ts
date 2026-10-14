import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, anaOwesPedro, netOf, pay, resolveSettlement, setStatus } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, eve } = users;

beforeAll(clearFirestore);

describe('settlements', () => {
  it('PRD: Pago pendiente no afecta balances; confirmado sí', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await anaOwesPedro(trip.id, ana, pedro, 2000);
    expect(await netOf(ana, trip.id, ana.uid)).toBe(-2000);

    const created = await pay(ana, trip.id, pedro.uid, 1000);
    expect(created.status).toBe(201);
    expect(created.json.settlement).toMatchObject({ fromUid: ana.uid, toUid: pedro.uid, amountMinor: 1000, status: 'pending', version: 1 });
    expect(created.json.exceedsDebt).toBe(false);
    expect(await netOf(ana, trip.id, ana.uid)).toBe(-2000);

    const confirmed = await resolveSettlement(pedro, trip.id, created.json.settlement.id, 'confirm');
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.settlement.status).toBe('confirmed');
    expect(confirmed.json.trip.confirmedSettlementCount).toBe(1);
    expect(await netOf(ana, trip.id, ana.uid)).toBe(-1000);
    const simplified = await call(ana, 'GET', `/v1/trips/${trip.id}/balances?view=simplified`);
    expect(simplified.json.transfers).toEqual([{ fromUid: ana.uid, toUid: pedro.uid, amountMinor: 1000 }]);
  });

  it('rejection with reason keeps balances; cancel by emitter; only the right person acts', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await anaOwesPedro(trip.id, ana, pedro, 2000);
    const s1 = (await pay(ana, trip.id, pedro.uid, 500)).json.settlement;
    expect((await resolveSettlement(ana, trip.id, s1.id, 'confirm')).status).toBe(403);
    expect((await resolveSettlement(juan, trip.id, s1.id, 'reject')).status).toBe(403);
    const rejected = await resolveSettlement(pedro, trip.id, s1.id, 'reject', { reason: 'No lo recibí' });
    expect(rejected.json.settlement).toMatchObject({ status: 'rejected', rejectionReason: 'No lo recibí' });
    expect(await netOf(ana, trip.id, ana.uid)).toBe(-2000);
    // Final states are immutable.
    expect((await resolveSettlement(pedro, trip.id, s1.id, 'confirm', { expectedVersion: 2 })).json.error.code).toBe('INVALID_TRANSITION');

    const s2 = (await pay(ana, trip.id, pedro.uid, 700)).json.settlement;
    expect((await resolveSettlement(pedro, trip.id, s2.id, 'cancel')).status).toBe(403);
    expect((await resolveSettlement(ana, trip.id, s2.id, 'cancel')).json.settlement.status).toBe('cancelled');
  });

  it('FR-008: a confirmed payment is corrected with a payment in the opposite direction', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await anaOwesPedro(trip.id, ana, pedro, 2000);
    const wrong = (await pay(ana, trip.id, pedro.uid, 5000)).json;
    expect(wrong.exceedsDebt).toBe(true);
    await resolveSettlement(pedro, trip.id, wrong.settlement.id, 'confirm');
    expect(await netOf(ana, trip.id, ana.uid)).toBe(3000);
    const back = (await pay(pedro, trip.id, ana.uid, 3000)).json.settlement;
    await resolveSettlement(ana, trip.id, back.id, 'confirm');
    expect(await netOf(ana, trip.id, ana.uid)).toBe(0);
  });

  it('validates amount, receiver and trip state; strangers get 404', async () => {
    const trip = await activeTrip(ana, [pedro]);
    expect((await pay(ana, trip.id, ana.uid, 100)).status).toBe(422);
    expect((await pay(ana, trip.id, pedro.uid, 0)).status).toBe(422);
    expect((await pay(ana, trip.id, eve.uid, 100)).status).toBe(422);
    expect((await pay(eve, trip.id, ana.uid, 100)).status).toBe(404);
    const pending = (await pay(ana, trip.id, pedro.uid, 100)).json.settlement;
    await setStatus(ana, trip.id, 'close', (await call(ana, 'GET', `/v1/trips/${trip.id}`)).json.trip.version);
    expect((await pay(ana, trip.id, pedro.uid, 100)).json.error.code).toBe('TRIP_READ_ONLY');
    expect((await resolveSettlement(pedro, trip.id, pending.id, 'confirm')).json.error.code).toBe('TRIP_READ_ONLY');
  });

  it('is idempotent and a concurrent double confirmation applies once', async () => {
    const trip = await activeTrip(ana, [pedro]);
    await anaOwesPedro(trip.id, ana, pedro, 2000);
    const key = crypto.randomUUID();
    const a = await pay(ana, trip.id, pedro.uid, 400, key);
    const b = await pay(ana, trip.id, pedro.uid, 400, key);
    expect(b.json.settlement.id).toBe(a.json.settlement.id);
    expect(await db.query(`trips/${trip.id}/settlements`)).toHaveLength(1);
    const [c1, c2] = await Promise.all([
      resolveSettlement(pedro, trip.id, a.json.settlement.id, 'confirm'),
      resolveSettlement(pedro, trip.id, a.json.settlement.id, 'confirm'),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 409]);
    expect(await netOf(ana, trip.id, ana.uid)).toBe(-1600);
  });
});
