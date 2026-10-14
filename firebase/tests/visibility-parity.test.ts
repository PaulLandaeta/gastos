import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canViewExpense } from '../../apps/api/src/services/visibility.js';
import { as, createEnv, seed } from './setup.js';

/**
 * Constitution II: the same visibility rule is enforced by the API (`canViewExpense`) and by the
 * Security Rules. This test runs one matrix against both and requires identical answers.
 */
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

const expense = {
  createdBy: 'author',
  payers: [{ uid: 'payer' }],
  items: [{ beneficiaries: ['benef'] }],
  viewerUids: ['author', 'benef', 'payer'],
  status: 'active' as const,
};

const matrix = [
  { uid: 'payer', role: 'member' },
  { uid: 'benef', role: 'member' },
  { uid: 'author', role: 'member' },
  { uid: 'other', role: 'member' },
  { uid: 'adm', role: 'admin' },
  { uid: 'boss', role: 'creator' },
] as const;

describe('visibility parity API ↔ Rules', () => {
  it.each(matrix)('$uid ($role)', async ({ uid, role }) => {
    const docs: Record<string, Record<string, unknown>> = { 'trips/t1': { name: 'x' }, 'trips/t1/expenses/e1': expense };
    for (const m of matrix) docs[`trips/t1/members/${m.uid}`] = { uid: m.uid, role: m.role, invitationStatus: 'accepted' };
    await seed(env, docs);
    const api = canViewExpense({ uid, role, invitationStatus: 'accepted' }, expense);
    const read = as(env, { uid }).firestore().doc('trips/t1/expenses/e1').get();
    if (api) await assertSucceeds(read);
    else await assertFails(read);
    expect(typeof api).toBe('boolean');
  });
});
