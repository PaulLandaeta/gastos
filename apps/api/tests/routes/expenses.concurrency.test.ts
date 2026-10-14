import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { users } from '../helpers/http.js';
import { accept, activeTrip, createTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan } = users;

beforeAll(clearFirestore);

describe('expense concurrency', () => {
  it('a last acceptance racing an expense never stores an expense while invitations are pending', async () => {
    for (let round = 0; round < 3; round++) {
      const trip = await createTrip(ana, { inviteEmails: [pedro.email] });
      const [acc, exp] = await Promise.all([
        accept(pedro, trip.id),
        postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid])),
      ]);
      expect(acc.status).toBe(200);
      expect([201, 409]).toContain(exp.status);
      if (exp.status === 409) expect(exp.json.error.code).toBe('TRIP_NOT_READY');
      const stored = await db.query(`trips/${trip.id}/expenses`);
      const tripDoc = await db.get(`trips/${trip.id}`);
      if (stored.length > 0) {
        expect(tripDoc?.data).toMatchObject({ status: 'active', pendingInvitationCount: 0, participantsLocked: true });
      } else {
        expect(tripDoc?.data['participantsLocked']).toBe(false);
      }
    }
  });

  it('parallel expenses never share a sequence number; CONFLICT responses are safe to retry with the same key', async () => {
    const trip = await activeTrip(ana, [juan]);
    // Distinct totals: identical ones would (correctly) trigger the duplicate warning of feature 002.
    const requests = Array.from({ length: 5 }, (_, i) => ({
      key: crypto.randomUUID(),
      body: equalExpense(ana.uid, [ana.uid, juan.uid], 1000 + i),
    }));
    let results = await Promise.all(requests.map((r) => postExpense(ana, trip.id, r.body, r.key)));
    for (const r of results) if (r.status !== 201) expect(r.json.error.code).toBe('CONFLICT');
    // Client-side retry of the contended ones, same idempotency key → exactly one effect each.
    for (let round = 0; round < 3 && results.some((r) => r.status !== 201); round++) {
      results = await Promise.all(
        results.map((r, i) => (r.status === 201 ? r : postExpense(ana, trip.id, requests[i]!.body, requests[i]!.key))),
      );
    }
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.map((r) => r.json.expense.seq).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await db.query(`trips/${trip.id}/expenses`)).toHaveLength(5);
  });
});
