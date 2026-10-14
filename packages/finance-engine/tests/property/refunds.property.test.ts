import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { combineEffects, originalDebts, refundEffect, simplifiedDebts, type Member } from '../../src/index.js';

describe('refundEffect properties', () => {
  it('zero-sum; both debt views net to the same balances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 12, maxLength: 12 }),
        fc.nat(),
        fc.nat(),
        (n, amount, weights, recipientSeed, rotation) => {
          const members: Member[] = Array.from({ length: n }, (_, i) => ({ uid: `m${i}`, joinOrder: i }));
          const itemCharges = Object.fromEntries(members.map((m, i) => [m.uid, weights[i]!]));
          const recipientUid = members[recipientSeed % n]!.uid;
          const r = refundEffect({ amountMinor: amount, recipientUid, itemCharges, rotation, members });
          expect(Object.values(r.chargesDelta).reduce((a, b) => a + b, 0)).toBe(amount);
          const nets = r.ledgerEffect.netByMember;
          expect(Object.values(nets).reduce((a, b) => a + b, 0)).toBe(0);
          const ledger = combineEffects(r.ledgerEffect);
          const fromTransfers = (ts: { fromUid: string; toUid: string; amountMinor: number }[]) => {
            const out: Record<string, number> = {};
            for (const t of ts) {
              out[t.fromUid] = (out[t.fromUid] ?? 0) - t.amountMinor;
              out[t.toUid] = (out[t.toUid] ?? 0) + t.amountMinor;
            }
            return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 0));
          };
          expect(fromTransfers(originalDebts(ledger, members))).toEqual(nets);
          expect(fromTransfers(simplifiedDebts(ledger, members))).toEqual(nets);
        },
      ),
      { numRuns: 2000 },
    );
  });
});
