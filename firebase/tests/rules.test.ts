import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { as, createEnv, seed } from './setup.js';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const ana = { uid: 'ana', email: 'ana@example.com' };

describe('baseline deny-by-default', () => {
  it('denies every client write, even on the own profile', async () => {
    const db = as(env, ana).firestore();
    await assertFails(db.doc('users/ana').set({ displayName: 'Ana' }));
    await assertFails(db.doc('trips/t1').set({ name: 'x' }));
    await assertFails(db.doc('trips/t1/expenses/e1').set({ totalMinor: 1 }));
    await assertFails(db.doc('anything/else').set({ a: 1 }));
  });

  it('denies anonymous reads everywhere', async () => {
    await seed(env, { 'users/ana': { uid: 'ana' }, 'trips/t1': { name: 'Uyuni' } });
    const db = as(env, null).firestore();
    await assertFails(db.doc('users/ana').get());
    await assertFails(db.doc('trips/t1').get());
  });

  it('denies reads of unknown paths', async () => {
    await seed(env, { 'secrets/s1': { v: 1 } });
    await assertFails(as(env, ana).firestore().doc('secrets/s1').get());
  });
});

const pedro = { uid: 'pedro', email: 'pedro@example.com' };

describe('users/{uid} (US2)', () => {
  beforeEach(async () => {
    await seed(env, {
      'users/ana': { uid: 'ana', displayName: 'Ana' },
      'users/ana/trips/t1': { tripId: 't1', name: 'Uyuni' },
    });
  });

  it('the owner can read the profile and the trips index', async () => {
    const db = as(env, ana).firestore();
    await assertSucceeds(db.doc('users/ana').get());
    await assertSucceeds(db.doc('users/ana/trips/t1').get());
    await assertSucceeds(db.collection('users/ana/trips').get());
  });

  it('another user cannot read them', async () => {
    const db = as(env, pedro).firestore();
    await assertFails(db.doc('users/ana').get());
    await assertFails(db.doc('users/ana/trips/t1').get());
    await assertFails(db.collection('users/ana/trips').get());
  });

  it('anonymous users cannot read them', async () => {
    const db = as(env, null).firestore();
    await assertFails(db.doc('users/ana').get());
    await assertFails(db.collection('users/ana/trips').get());
  });
});

describe('trips, members and invitations (US3)', () => {
  const juan = { uid: 'juan', email: 'juan@example.com' };
  const eve = { uid: 'eve', email: 'eve@example.com' };

  beforeEach(async () => {
    await seed(env, {
      'trips/t1': { name: 'Uyuni', status: 'pending' },
      'trips/t1/members/ana': { uid: 'ana', role: 'creator', invitationStatus: 'accepted' },
      'trips/t1/members/pedro': { uid: 'pedro', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/members/inv_juan': { uid: null, email: 'juan@example.com', invitationStatus: 'invited' },
      'invitations/juan@example.com/trips/t1': { tripId: 't1', tripName: 'Uyuni', status: 'invited' },
      'trips/t1/expenses/e1': { totalMinor: 100 },
      'trips/t1/projections/ledger': { netByMember: {} },
      'trips/t1/auditEvents/a1': { action: 'trip.create' },
      'idempotencyKeys/t1_ana_k': { operation: 'expense.create' },
    });
  });

  it('accepted members read the trip and all member rows', async () => {
    for (const who of [ana, pedro]) {
      const db = as(env, who).firestore();
      await assertSucceeds(db.doc('trips/t1').get());
      await assertSucceeds(db.collection('trips/t1/members').get());
      await assertSucceeds(db.doc('trips/t1/members/inv_juan').get());
    }
  });

  it('an invitee who has not accepted cannot read the trip or its members', async () => {
    const db = as(env, juan).firestore();
    await assertFails(db.doc('trips/t1').get());
    await assertFails(db.collection('trips/t1/members').get());
    await assertFails(db.doc('trips/t1/members/inv_juan').get());
  });

  it('strangers cannot read anything of the trip', async () => {
    const db = as(env, eve).firestore();
    await assertFails(db.doc('trips/t1').get());
    await assertFails(db.collection('trips/t1/members').get());
  });

  it('the invitee reads its invitation only with the matching verified e-mail', async () => {
    await assertSucceeds(as(env, juan).firestore().doc('invitations/juan@example.com/trips/t1').get());
    await assertSucceeds(as(env, juan).firestore().collection('invitations/juan@example.com/trips').get());
    await assertSucceeds(
      as(env, { uid: 'juan', email: 'Juan@Example.com' }).firestore().doc('invitations/juan@example.com/trips/t1').get(),
    );
    await assertFails(as(env, eve).firestore().doc('invitations/juan@example.com/trips/t1').get());
    await assertFails(
      as(env, { ...juan, emailVerified: false }).firestore().doc('invitations/juan@example.com/trips/t1').get(),
    );
  });

  it('expenses, projections, audit and idempotency keys are never readable by clients', async () => {
    for (const who of [ana, pedro]) {
      const db = as(env, who).firestore();
      await assertFails(db.doc('trips/t1/expenses/e1').get());
      await assertFails(db.collection('trips/t1/expenses').get());
      await assertFails(db.doc('trips/t1/projections/ledger').get());
      await assertFails(db.doc('trips/t1/auditEvents/a1').get());
      await assertFails(db.doc('idempotencyKeys/t1_ana_k').get());
    }
  });

  it('members cannot write the trip, members or invitations', async () => {
    const db = as(env, ana).firestore();
    await assertFails(db.doc('trips/t1').update({ name: 'x' }));
    await assertFails(db.doc('trips/t1/members/pedro').update({ role: 'admin' }));
    await assertFails(as(env, juan).firestore().doc('invitations/juan@example.com/trips/t1').update({ status: 'accepted' }));
  });
});
