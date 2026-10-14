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

  it('projections, audit and idempotency keys are never readable by clients (expenses: see 002 suite)', async () => {
    for (const who of [ana, pedro]) {
      const db = as(env, who).firestore();
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

describe('expenses privacy (002)', () => {
  const juan = { uid: 'juan', email: 'juan@example.com' };
  const eve = { uid: 'eve', email: 'eve@example.com' };
  const adm = { uid: 'adm', email: 'adm@example.com' };

  beforeEach(async () => {
    await seed(env, {
      'trips/t1': { name: 'Uyuni', status: 'active' },
      'trips/t1/members/ana': { uid: 'ana', role: 'creator', invitationStatus: 'accepted' },
      'trips/t1/members/pedro': { uid: 'pedro', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/members/juan': { uid: 'juan', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/members/adm': { uid: 'adm', role: 'admin', invitationStatus: 'accepted' },
      'trips/t1/expenses/e1': { viewerUids: ['ana', 'pedro'], totalMinor: 1000, transactionDate: '2026-11-01', createdAt: new Date() },
      'trips/t1/expenses/e2': { viewerUids: ['juan'], totalMinor: 500, transactionDate: '2026-11-02', createdAt: new Date() },
      'trips/t1/categories/default-food': { name: 'Comida', active: true },
      'trips/t1/projections/public': { sharedTotalMinor: 1500 },
      'trips/t1/projections/categories': { byCategory: {} },
      'trips/t1/memberStats/juan': { contributedMinor: 500 },
    });
  });

  it('viewers read their expenses; non-involved members cannot (PRD: comprobante privado)', async () => {
    await assertSucceeds(as(env, pedro).firestore().doc('trips/t1/expenses/e1').get());
    await assertFails(as(env, juan).firestore().doc('trips/t1/expenses/e1').get());
    await assertSucceeds(as(env, juan).firestore().doc('trips/t1/expenses/e2').get());
  });

  it('creator and admins read every expense; strangers none', async () => {
    await assertSucceeds(as(env, ana).firestore().doc('trips/t1/expenses/e2').get());
    await assertSucceeds(as(env, adm).firestore().doc('trips/t1/expenses/e1').get());
    await assertSucceeds(as(env, adm).firestore().collection('trips/t1/expenses').get());
    await assertFails(as(env, eve).firestore().doc('trips/t1/expenses/e1').get());
  });

  it('a demoted admin loses access immediately', async () => {
    await seed(env, { 'trips/t1/members/adm': { uid: 'adm', role: 'member', invitationStatus: 'accepted' } });
    await assertFails(as(env, adm).firestore().doc('trips/t1/expenses/e1').get());
  });

  it('members must constrain list queries with viewerUids array-contains', async () => {
    const db = as(env, juan).firestore();
    await assertFails(db.collection('trips/t1/expenses').get());
    await assertSucceeds(db.collection('trips/t1/expenses').where('viewerUids', 'array-contains', 'juan').get());
    await assertFails(db.collection('trips/t1/expenses').where('viewerUids', 'array-contains', 'ana').get());
  });

  it('categories are readable by members only', async () => {
    await assertSucceeds(as(env, juan).firestore().doc('trips/t1/categories/default-food').get());
    await assertFails(as(env, eve).firestore().doc('trips/t1/categories/default-food').get());
  });

  it('projections and memberStats are never readable by clients (dashboard via API)', async () => {
    for (const who of [ana, adm, juan]) {
      const db = as(env, who).firestore();
      await assertFails(db.doc('trips/t1/projections/public').get());
      await assertFails(db.doc('trips/t1/projections/categories').get());
      await assertFails(db.doc('trips/t1/memberStats/juan').get());
    }
  });

  it('clients cannot write expenses or categories', async () => {
    await assertFails(as(env, ana).firestore().doc('trips/t1/expenses/e3').set({ viewerUids: ['ana'] }));
    await assertFails(as(env, adm).firestore().doc('trips/t1/categories/x').set({ name: 'X' }));
  });
});

describe('settlements and refunds (003)', () => {
  const juan = { uid: 'juan', email: 'juan@example.com' };
  const eve = { uid: 'eve', email: 'eve@example.com' };

  beforeEach(async () => {
    await seed(env, {
      'trips/t1': { name: 'Uyuni' },
      'trips/t1/members/ana': { uid: 'ana', role: 'creator', invitationStatus: 'accepted' },
      'trips/t1/members/pedro': { uid: 'pedro', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/members/juan': { uid: 'juan', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/settlements/s1': { fromUid: 'pedro', toUid: 'ana', amountMinor: 500, status: 'pending' },
      'trips/t1/expenses/e1': { viewerUids: ['pedro'], totalMinor: 1000 },
      'trips/t1/expenses/e1/refunds/r1': { itemId: 'i', amountMinor: 100 },
    });
  });

  it('every member reads settlements; strangers do not', async () => {
    await assertSucceeds(as(env, juan).firestore().doc('trips/t1/settlements/s1').get());
    await assertSucceeds(as(env, juan).firestore().collection('trips/t1/settlements').get());
    await assertFails(as(env, eve).firestore().doc('trips/t1/settlements/s1').get());
  });

  it('refunds inherit the parent expense visibility', async () => {
    await assertSucceeds(as(env, pedro).firestore().doc('trips/t1/expenses/e1/refunds/r1').get());
    await assertSucceeds(as(env, ana).firestore().collection('trips/t1/expenses/e1/refunds').get());
    await assertFails(as(env, juan).firestore().doc('trips/t1/expenses/e1/refunds/r1').get());
    await assertFails(as(env, eve).firestore().doc('trips/t1/expenses/e1/refunds/r1').get());
  });

  it('clients cannot write settlements or refunds', async () => {
    await assertFails(as(env, pedro).firestore().doc('trips/t1/settlements/s2').set({ amountMinor: 1 }));
    await assertFails(as(env, ana).firestore().doc('trips/t1/settlements/s1').update({ status: 'confirmed' }));
    await assertFails(as(env, pedro).firestore().doc('trips/t1/expenses/e1/refunds/r2').set({ amountMinor: 1 }));
  });
});

describe('attachments, uploads, scans and aiUsage (004)', () => {
  const juan = { uid: 'juan', email: 'juan@example.com' };
  const eve = { uid: 'eve', email: 'eve@example.com' };
  const adm = { uid: 'adm', email: 'adm@example.com' };

  beforeEach(async () => {
    await seed(env, {
      'trips/t1': { name: 'Uyuni' },
      'trips/t1/members/ana': { uid: 'ana', role: 'creator', invitationStatus: 'accepted' },
      'trips/t1/members/pedro': { uid: 'pedro', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/members/juan': { uid: 'juan', role: 'member', invitationStatus: 'accepted' },
      'trips/t1/members/adm': { uid: 'adm', role: 'admin', invitationStatus: 'accepted' },
      'trips/t1/expenses/e1': { viewerUids: ['pedro'], totalMinor: 1000 },
      'trips/t1/expenses/e1/attachments/a1': { fileName: 'ticket.jpg', status: 'active' },
      'trips/t1/settlements/s1': { fromUid: 'pedro', toUid: 'juan', amountMinor: 500, status: 'pending' },
      'trips/t1/settlements/s1/attachments/a2': { fileName: 'proof.pdf', status: 'active' },
      'trips/t1/uploads/u1': { uploadedBy: 'pedro', status: 'pending' },
      'trips/t1/scans/sc1': { requestedBy: 'pedro', status: 'succeeded' },
      'trips/t1/aiUsage/2026-11-02': { requests: 1 },
      'aiUsage/2026-11-02': { requests: 1 },
    });
  });

  it('expense attachments follow the parent expense (PRD: comprobante privado)', async () => {
    await assertSucceeds(as(env, pedro).firestore().doc('trips/t1/expenses/e1/attachments/a1').get());
    await assertSucceeds(as(env, ana).firestore().collection('trips/t1/expenses/e1/attachments').get());
    await assertSucceeds(as(env, adm).firestore().doc('trips/t1/expenses/e1/attachments/a1').get());
    await assertFails(as(env, juan).firestore().doc('trips/t1/expenses/e1/attachments/a1').get());
    await assertFails(as(env, eve).firestore().doc('trips/t1/expenses/e1/attachments/a1').get());
  });

  it('settlement attachments: payer, receiver and managers only', async () => {
    await assertSucceeds(as(env, pedro).firestore().doc('trips/t1/settlements/s1/attachments/a2').get());
    await assertSucceeds(as(env, juan).firestore().doc('trips/t1/settlements/s1/attachments/a2').get());
    await assertSucceeds(as(env, ana).firestore().doc('trips/t1/settlements/s1/attachments/a2').get());
    await seed(env, { 'trips/t1/settlements/s1': { fromUid: 'ana', toUid: 'adm', amountMinor: 1, status: 'pending' } });
    await assertFails(as(env, pedro).firestore().doc('trips/t1/settlements/s1/attachments/a2').get());
    await assertFails(as(env, eve).firestore().doc('trips/t1/settlements/s1/attachments/a2').get());
  });

  it('uploads and scans are readable only by their owner (not even managers)', async () => {
    await assertSucceeds(as(env, pedro).firestore().doc('trips/t1/uploads/u1').get());
    await assertSucceeds(as(env, pedro).firestore().doc('trips/t1/scans/sc1').get());
    for (const who of [ana, adm, juan, eve]) {
      await assertFails(as(env, who).firestore().doc('trips/t1/uploads/u1').get());
      await assertFails(as(env, who).firestore().doc('trips/t1/scans/sc1').get());
    }
  });

  it('aiUsage is never readable and nothing is writable', async () => {
    for (const who of [ana, adm, pedro]) {
      await assertFails(as(env, who).firestore().doc('trips/t1/aiUsage/2026-11-02').get());
      await assertFails(as(env, who).firestore().doc('aiUsage/2026-11-02').get());
    }
    await assertFails(as(env, pedro).firestore().doc('trips/t1/uploads/u2').set({ uploadedBy: 'pedro' }));
    await assertFails(as(env, pedro).firestore().doc('trips/t1/expenses/e1/attachments/a3').set({ fileName: 'x' }));
  });
});
