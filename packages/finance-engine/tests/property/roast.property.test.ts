import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  memberRanking,
  originalDebts,
  roastRanking,
  simplifiedDebts,
  type LedgerEffect,
  type Member,
} from '../../src/index.js';

const NUM_RUNS = Number(process.env['FC_RUNS'] ?? 2_000);

/** A valid ledger: random gross pairwise debts among 1..12 members; nets derived from them. */
const ledgerArb = fc.integer({ min: 1, max: 12 }).chain((n) => {
  const members: Member[] = Array.from({ length: n }, (_, i) => ({ uid: `u${String(i).padStart(2, '0')}`, joinOrder: i }));
  const debt = fc.record({
    from: fc.integer({ min: 0, max: n - 1 }),
    to: fc.integer({ min: 0, max: n - 1 }),
    amount: fc.integer({ min: 1, max: 1_000_000 }),
  });
  return fc.array(debt, { maxLength: 30 }).map((debts) => {
    const ledger: LedgerEffect = { netByMember: {}, pairwise: {} };
    for (const m of members) ledger.netByMember[m.uid] = 0;
    for (const d of debts) {
      if (d.from === d.to) continue;
      const a = members[d.from]!.uid;
      const b = members[d.to]!.uid;
      ledger.pairwise[`${a}>${b}`] = (ledger.pairwise[`${a}>${b}`] ?? 0) + d.amount;
      ledger.netByMember[a]! -= d.amount;
      ledger.netByMember[b]! += d.amount;
    }
    return { members, ledger };
  });
});

const netsOf = (ledger: LedgerEffect) => Object.entries(ledger.netByMember).map(([uid, netMinor]) => ({ uid, netMinor }));

describe('roastRanking tier properties (feature 007, SC-001)', () => {
  it('one entry per member, at most one top, macho iff net ≥ 0, golfa iff > 50 %, stable order', () => {
    fc.assert(
      fc.property(ledgerArb, ({ members, ledger }) => {
        const nets = netsOf(ledger);
        const r = roastRanking(nets, [], members);
        expect(r.map((e) => e.uid).sort()).toEqual(nets.map((x) => x.uid).sort());

        const debtors = nets.filter((x) => x.netMinor < 0);
        const tops = r.filter((e) => e.tier === 'top');
        expect(tops.length).toBe(debtors.length > 0 ? 1 : 0);
        const maxDebt = Math.max(0, ...debtors.map((x) => -x.netMinor));
        if (tops[0]) expect(tops[0].debtMinor).toBe(maxDebt);

        for (const e of r) {
          expect(e.tier === 'macho').toBe(e.netMinor >= 0);
          expect(e.debtMinor).toBe(Math.max(0, -e.netMinor));
          if (e.tier !== 'top' && e.tier !== 'macho') expect(e.tier === 'golfa').toBe(2 * e.debtMinor > maxDebt);
        }

        const rank = memberRanking(members);
        for (let i = 1; i < r.length; i++) {
          const a = r[i - 1]!;
          const b = r[i]!;
          expect(a.debtMinor > b.debtMinor || (a.debtMinor === b.debtMinor && rank.get(a.uid)! < rank.get(b.uid)!)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic for any input order', () => {
    fc.assert(
      fc.property(ledgerArb, fc.integer(), ({ members, ledger }, seed) => {
        const nets = netsOf(ledger);
        const shuffled = [...nets].sort((a, b) => ((a.uid.charCodeAt(2) * seed) % 7) - ((b.uid.charCodeAt(2) * seed) % 7));
        expect(roastRanking(shuffled, [], [...members].reverse())).toEqual(roastRanking(nets, [], members));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('roastRanking relation properties (feature 007, FR-013, SC-002)', () => {
  it('in both views, what each member owes minus what they are owed equals their debt; tiers match', () => {
    fc.assert(
      fc.property(ledgerArb, ({ members, ledger }) => {
        const nets = netsOf(ledger);
        const views = [originalDebts(ledger, members), simplifiedDebts(ledger, members)].map((t) => roastRanking(nets, t, members));
        for (const r of views) {
          const owed: Record<string, number> = {};
          for (const e of r) for (const o of e.owes) owed[o.toUid] = (owed[o.toUid] ?? 0) + o.amountMinor;
          const rank = memberRanking(members);
          for (const e of r) {
            const out = e.owes.reduce((s, o) => s + o.amountMinor, 0);
            expect(out - (owed[e.uid] ?? 0)).toBe(0 - e.netMinor || 0);
            expect(e.mainOwnerUid).toBe(e.owes[0]?.toUid ?? null);
            for (let i = 1; i < e.owes.length; i++) {
              const p = e.owes[i - 1]!;
              const q = e.owes[i]!;
              expect(p.amountMinor > q.amountMinor || (p.amountMinor === q.amountMinor && rank.get(p.toUid)! < rank.get(q.toUid)!)).toBe(true);
            }
          }
        }
        expect(views[0]!.map((e) => e.tier)).toEqual(views[1]!.map((e) => e.tier));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
