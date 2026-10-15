import { describe, expect, it } from 'vitest';
import type { Firestore } from '../src/firestore/client.js';
import { decodeFields, encodeFields } from '../src/firestore/codec.js';
import { anonymizeInTrip } from '../src/services/accountDeletion.js';

/**
 * In-memory Firestore that pays the same codec cost as the REST client (every read decodes the
 * encoded fields, every write encodes them), so the measured time ≈ Worker CPU of the step.
 */
function memoryDb(seed: Record<string, Record<string, unknown>>) {
  const docs = new Map(Object.entries(seed).map(([p, d]) => [p, encodeFields(d)]));
  const read = (path: string) => {
    const f = docs.get(path);
    return f ? { id: path.split('/').pop()!, path, data: decodeFields(f), updateTime: 't', createTime: 't' } : null;
  };
  const tx = {
    get: async (p: string) => read(p),
    query: async (collection: string) =>
      [...docs.keys()].filter((p) => p.startsWith(`${collection}/`) && p.split('/').length === collection.split('/').length + 1).map((p) => read(p)!),
    set: (p: string, d: Record<string, unknown>) => void docs.set(p, encodeFields(d)),
    update: (p: string, d: Record<string, unknown>) => void docs.set(p, encodeFields({ ...decodeFields(docs.get(p)!), ...d })),
    delete: (p: string) => void docs.delete(p),
  };
  return { db: { runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } as unknown as Firestore, docs };
}

function seedTrip(tripId: string, members: number) {
  const seed: Record<string, Record<string, unknown>> = {
    [`trips/${tripId}`]: {
      name: 'Uyuni', startDate: '2026-11-01', endDate: '2026-11-05', currency: 'BOB', status: 'active', previousStatus: null,
      creatorUid: 'u0', participantsLocked: true, currencyLocked: true, firstExpenseAt: new Date(), expenseSeq: 500,
      memberCount: members, pendingInvitationCount: 0, declinedInvitationCount: 0, createdAt: new Date(), updatedAt: new Date(), schemaVersion: 1, version: 900,
    },
    'accountDeletions/u0': { uid: 'u0', status: 'in_progress', tripIds: [tripId], pendingTripIds: [tripId], steps: {}, formerNames: [], formerEmail: 'u0@example.com', attempts: 0, version: 1 },
  };
  for (let i = 0; i < members; i++) {
    seed[`trips/${tripId}/members/u${i}`] = {
      uid: `u${i}`, email: `u${i}@example.com`, displayName: `Persona ${i}`, role: i === 0 ? 'creator' : i === 1 ? 'admin' : 'member',
      invitationStatus: 'accepted', invitedAt: new Date(), acceptedAt: new Date(), joinOrder: i, schemaVersion: 1, version: 3,
    };
  }
  return seed;
}

describe('CPU budget of the account deletion (feature 006, Workers Free: 10 ms)', () => {
  it('anonymizing one trip of 10 members (creator transfer included) stays below 5 ms', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      const { db, docs } = memoryDb(seedTrip(`t${i}`, 10));
      const t0 = performance.now();
      await anonymizeInTrip(db, 'u0', `t${i}`, new Date());
      samples.push(performance.now() - t0);
      // The measured run really anonymized and transferred the creator role.
      expect(decodeFields(docs.get(`trips/t${i}/members/u0`)!)).toMatchObject({ displayName: 'Participante eliminado 1', email: '' });
      expect(decodeFields(docs.get(`trips/t${i}/members/u1`)!)['role']).toBe('creator');
    }
    const median = samples.slice(10).sort((a, b) => a - b)[25]!;
    console.log(JSON.stringify({ anonymizeTripMs: median.toFixed(3) }));
    expect(median).toBeLessThan(5);
  });
});
