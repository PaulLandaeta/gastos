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

  it('parallel expenses receive unique consecutive sequence numbers', async () => {
    const trip = await activeTrip(ana, [juan]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, juan.uid]))),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.map((r) => r.json.expense.seq).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
