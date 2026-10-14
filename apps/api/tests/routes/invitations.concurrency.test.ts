import { beforeAll, describe, expect, it } from 'vitest';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { accept, createTrip } from '../helpers/trips.js';

const { ana, pedro, juan, luis } = users;

beforeAll(clearFirestore);

describe('concurrency (FR-031)', () => {
  it('simultaneous acceptances keep counters and join orders consistent', async () => {
    const trip = await createTrip(ana, { inviteEmails: [pedro.email, juan.email, luis.email] });
    const results = await Promise.all([accept(pedro, trip.id), accept(juan, trip.id), accept(luis, trip.id)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const current = await call(ana, 'GET', `/v1/trips/${trip.id}`);
    expect(current.json.trip).toMatchObject({ status: 'active', memberCount: 4, pendingInvitationCount: 0 });
    const orders = current.json.members.map((m: { joinOrder: number }) => m.joinOrder).sort();
    expect(orders).toEqual([0, 1, 2, 3]);
  });

  it('two edits with the same expectedVersion: exactly one wins, the other gets CONFLICT', async () => {
    const trip = await createTrip(ana);
    const [a, b] = await Promise.all([
      call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'A' } }),
      call(ana, 'PATCH', `/v1/trips/${trip.id}`, { body: { expectedVersion: trip.version, name: 'B' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
