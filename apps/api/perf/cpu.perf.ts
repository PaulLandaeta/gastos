import { computeExpense, combineEffects, simplifiedDebts, originalDebts, type Member } from 'finance-engine';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { verifyIdToken } from '../src/auth/verifyIdToken.js';
import { decodeFields, encodeFields } from '../src/firestore/codec.js';

/** Median wall time (ms) of `fn` after warm-up; synchronous work ≈ CPU time. */
async function median(fn: () => unknown | Promise<unknown>, runs = 40): Promise<number> {
  for (let i = 0; i < 10; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(runs / 2)]!;
}

describe('CPU budget per request (Workers Free: 10 ms)', () => {
  it('worst-case "create expense" request stays well below 10 ms of CPU', async () => {
    // 1. ID token verification (RS256 with WebCrypto, JWKS cached).
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256' }] });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: 'a@example.com', email_verified: true, auth_time: now, firebase: { sign_in_provider: 'google.com' } })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' })
      .setSubject('u0').setIssuer('https://securetoken.google.com/p').setAudience('p').setIssuedAt().setExpirationTime('1h')
      .sign(privateKey);
    const verify = await median(() => verifyIdToken(token, { ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'p' }, { keySet }));

    // 2. Decoding the trip + 50 member documents returned by Firestore REST.
    const members: Member[] = Array.from({ length: 50 }, (_, i) => ({ uid: `u${i}`, joinOrder: i }));
    const memberFields = members.map((m) =>
      encodeFields({ uid: m.uid, email: `${m.uid}@example.com`, role: 'member', invitationStatus: 'accepted', joinOrder: m.joinOrder, version: 1, acceptedAt: new Date() }),
    );
    const decode = await median(() => memberFields.map((f) => decodeFields(f)));

    // 3. Finance engine: 100 items × 50 members + ledger update + both debt views.
    const uids = members.map((m) => m.uid);
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `i${index}`, index, grossMinor: 10_001 + index, discountMinor: 0, classification: 'shared' as const,
      beneficiaries: uids, allocation: { mode: 'equal' as const },
    }));
    const total = items.reduce((a, i) => a + i.grossMinor, 0);
    const input = { seq: 3, totalMinor: total, payers: [{ uid: 'u0', amountMinor: total - 5 }, { uid: 'u1', amountMinor: 5 }],
      splitMode: 'items' as const, items, adjustments: [], members };
    const engine = await median(() => {
      const r = computeExpense(input);
      const ledger = combineEffects(r.ledgerEffect, r.ledgerEffect);
      simplifiedDebts(ledger, members);
      originalDebts(ledger, members);
      return encodeFields({ items, ledgerEffect: r.ledgerEffect, chargesByMember: r.chargesByMember });
    });

    const totalMs = verify + decode + engine;
    console.log(JSON.stringify({ verifyMs: verify.toFixed(3), decodeMs: decode.toFixed(3), engineMs: engine.toFixed(3), totalMs: totalMs.toFixed(3) }));
    expect(totalMs).toBeLessThan(5); // 50 % headroom against the 10 ms limit
  });
});

describe('CPU budget — expense v2 with projections (feature 002)', () => {
  it('engine + visibility + projections for 4 viewers stays well below 10 ms', async () => {
    const { applyExpense, rebuildProjections } = await import('../src/services/projections.js');
    const { viewerUidsOf } = await import('../src/services/visibility.js');
    const members: Member[] = ['a', 'b', 'c', 'd'].map((uid, joinOrder) => ({ uid, joinOrder }));
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `i${index}`, index, grossMinor: 1_000 + index, discountMinor: 0,
      classification: (index % 5 === 0 ? 'personal' : 'shared') as 'personal' | 'shared',
      beneficiaries: index % 5 === 0 ? ['a'] : ['a', 'b', 'c', 'd'], allocation: { mode: 'equal' as const },
    }));
    const total = items.reduce((s, i) => s + i.grossMinor, 0);
    const input = { seq: 12, totalMinor: total, payers: [{ uid: 'b', amountMinor: total }], splitMode: 'items' as const, items, adjustments: [], members };
    const ms = await median(() => {
      const r = computeExpense(input);
      const charges = Object.values(r.chargesByMember);
      const exp = {
        categoryId: 'default-food',
        payers: input.payers,
        chargesByMember: r.chargesByMember,
        viewerUids: viewerUidsOf({ createdBy: 'c', payers: input.payers, items }),
        sharedTotalMinor: charges.reduce((s, c) => s + c.sharedMinor, 0),
      };
      const p = rebuildProjections([]);
      applyExpense(p, exp, 1);
      return encodeFields({ ...exp, items, ledgerEffect: r.ledgerEffect, p: p.memberStats });
    });
    console.log(JSON.stringify({ expenseV2Ms: ms.toFixed(3) }));
    expect(ms).toBeLessThan(5);
  });
});

describe('CPU budget — edit and refund (feature 003)', () => {
  it('edit (−old +new) plus a refund effect stays well below 10 ms', async () => {
    const { combineEffects, negateEffect, refundEffect, itemChargesByMember } = await import('finance-engine');
    const members: Member[] = Array.from({ length: 10 }, (_, i) => ({ uid: `u${i}`, joinOrder: i }));
    const uids = members.map((m) => m.uid);
    const items = Array.from({ length: 80 }, (_, index) => ({
      id: `i${index}`, index, grossMinor: 2_000 + index, discountMinor: 0, classification: 'shared' as const,
      beneficiaries: uids, allocation: { mode: 'equal' as const },
    }));
    const total = items.reduce((s, i) => s + i.grossMinor, 0);
    const base = { seq: 5, totalMinor: total, payers: [{ uid: 'u0', amountMinor: total }], splitMode: 'items' as const, items, adjustments: [], members };
    const old = computeExpense(base).ledgerEffect;
    const ms = await median(() => {
      const next = computeExpense({ ...base, seq: 5 }).ledgerEffect;
      const delta = combineEffects(negateEffect(old), next);
      const r = refundEffect({ amountMinor: 1_000, recipientUid: 'u3', itemCharges: itemChargesByMember(base, 'i7'), rotation: 11, members });
      return combineEffects(delta, r.ledgerEffect);
    });
    console.log(JSON.stringify({ editRefundMs: ms.toFixed(3) }));
    expect(ms).toBeLessThan(5);
  });
});
