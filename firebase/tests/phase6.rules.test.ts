import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { as, createEnv, seed } from './setup.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const ana = { uid: 'ana', email: 'ana@example.com' };
const ghost = { uid: 'ghost', email: 'ghost@example.com' };

describe('deleted members (feature 006, RF-56)', () => {
  beforeEach(async () => {
    await env.clearFirestore();
    await seed(env, {
      'trips/t1': { name: 'Uyuni', creatorUid: 'ana' },
      'trips/t1/members/ana': { uid: 'ana', role: 'creator', invitationStatus: 'accepted', deletedAt: null },
      'trips/t1/members/ghost': { uid: 'ghost', role: 'admin', invitationStatus: 'accepted', deletedAt: new Date(), displayName: 'Participante eliminado 1' },
      'trips/t1/expenses/e1': { viewerUids: ['ana', 'ghost'], totalMinor: 100 },
      'trips/t1/settlements/s1': { fromUid: 'ghost', toUid: 'ana', amountMinor: 100 },
      'trips/t1/categories/c1': { name: 'Comida' },
      'accountDeletions/ghost': { uid: 'ghost', status: 'completed' },
      'ops/health': { ok: true },
    });
  });

  it('an active member still reads the trip, including the deleted member row', async () => {
    const db = as(env, ana).firestore();
    await assertSucceeds(db.doc('trips/t1').get());
    await assertSucceeds(db.doc('trips/t1/members/ghost').get());
    await assertSucceeds(db.doc('trips/t1/expenses/e1').get());
  });

  it('a deleted member (token still valid) reads nothing of the trip', async () => {
    const db = as(env, ghost).firestore();
    await assertFails(db.doc('trips/t1').get());
    await assertFails(db.collection('trips/t1/members').get());
    await assertFails(db.doc('trips/t1/expenses/e1').get());
    await assertFails(db.collection('trips/t1/expenses').where('viewerUids', 'array-contains', 'ghost').get());
    await assertFails(db.doc('trips/t1/settlements/s1').get());
    await assertFails(db.doc('trips/t1/categories/c1').get());
  });

  it('nobody reads the deletion registry or ops documents', async () => {
    for (const who of [ana, ghost]) {
      const db = as(env, who).firestore();
      await assertFails(db.doc('accountDeletions/ghost').get());
      await assertFails(db.doc('ops/health').get());
    }
  });
});
