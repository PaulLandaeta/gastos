import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, juan } = users;

beforeAll(clearFirestore);

/**
 * Feature 005, SC-001: the offline queue resends with the key fixed at creation. Repeated and
 * interrupted sends must leave exactly one expense per key.
 */
describe('offline queue idempotency (SC-001)', () => {
  it('20 pending expenses, each sent 3 times concurrently, are stored exactly once', { timeout: 180_000 }, async () => {
    const trip = await activeTrip(ana, [juan]);
    const pending = Array.from({ length: 20 }, (_, i) => ({
      key: crypto.randomUUID(),
      body: equalExpense(ana.uid, [ana.uid, juan.uid], 1000 + i),
    }));

    // The queue sends in creation order; each one is duplicated 3 times in parallel (two tabs + a
    // retry after a lost response). Whatever did not come back as 201 is resent with the same key.
    const done = new Map<string, string>();
    for (const p of pending) {
      for (let round = 0; round < 10 && !done.has(p.key); round++) {
        const results = await Promise.all([1, 2, 3].map(() => postExpense(ana, trip.id, p.body, p.key)));
        for (const r of results) {
          if (r.status === 201) {
            const id = r.json.expense.id as string;
            // Every successful answer for the same key names the same expense.
            expect(done.get(p.key) ?? id).toBe(id);
            done.set(p.key, id);
          } else {
            expect(r.json.error.code).toBe('CONFLICT');
          }
        }
      }
    }

    expect(done.size).toBe(20);
    const stored = await db.query(`trips/${trip.id}/expenses`);
    expect(stored).toHaveLength(20);
    expect(stored.map((d) => d.data['seq']).sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );

    // Balances still reconcile: Ana paid everything, Juan owes exactly his charges (each counted once).
    const balances = await call(ana, 'GET', `/v1/trips/${trip.id}/balances?view=original`);
    const net = Object.fromEntries(balances.json.netByMember.map((m: { uid: string; netMinor: number }) => [m.uid, m.netMinor]));
    const juanCharges = stored.reduce(
      (a, d) => a + (d.data['chargesByMember'] as Record<string, { netMinor: number }>)[juan.uid]!.netMinor,
      0,
    );
    expect(net[ana.uid] + net[juan.uid]).toBe(0);
    expect(net[juan.uid]).toBe(-juanCharges);
  });

  it('a send whose response was lost is replayed with the same result, days later', async () => {
    const trip = await activeTrip(ana, [juan]);
    const key = crypto.randomUUID();
    const body = equalExpense(ana.uid, [ana.uid, juan.uid], 777);
    const first = await postExpense(ana, trip.id, body, key);
    expect(first.status).toBe(201);
    // The device never saw `first` and resends the same pending expense.
    const replay = await postExpense(ana, trip.id, body, key);
    expect(replay.status).toBe(201);
    expect(replay.json.expense.id).toBe(first.json.expense.id);
    expect(await db.query(`trips/${trip.id}/expenses`)).toHaveLength(1);
  });
});
