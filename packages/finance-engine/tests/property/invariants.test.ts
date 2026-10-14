import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEDGER,
  combineEffects,
  computeExpense,
  negateEffect,
  originalDebts,
  paymentEffect,
  rebuildLedger,
  simplifiedDebts,
  type Allocation,
  type ExpenseInput,
  type ExpenseItem,
  type GeneralAdjustment,
  type LedgerEffect,
  type Member,
  type Payment,
  type Transfer,
} from '../../src/index.js';

const NUM_RUNS = Number(process.env['FC_RUNS'] ?? 10_000);

/** Splits `total` into `parts` non-negative integers (deterministic from `cuts`). */
function splitInteger(total: number, cuts: number[], parts: number): number[] {
  const points = cuts.slice(0, parts - 1).map((c) => Math.floor(c * (total + 1)) % (total + 1));
  points.sort((a, b) => a - b);
  const out: number[] = [];
  let prev = 0;
  for (const p of points) {
    out.push(p - prev);
    prev = p;
  }
  out.push(total - prev);
  return out;
}

const sum = (xs: Iterable<number>) => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function netsFromTransfers(transfers: Transfer[]): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const t of transfers) {
    nets[t.fromUid] = (nets[t.fromUid] ?? 0) + t.amountMinor;
    nets[t.toUid] = (nets[t.toUid] ?? 0) - t.amountMinor;
  }
  for (const k of Object.keys(nets)) if (nets[k] === 0) delete nets[k];
  return nets;
}

const nonZero = (r: Record<string, number>) =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => v !== 0));

const fraction = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

const expenseArb = (members: Member[], seq: number) =>
  fc
    .record({
      items: fc.array(
        fc.record({
          gross: fc.integer({ min: 1, max: 1_000_000 }),
          discountFrac: fraction,
          personal: fc.boolean(),
          benefSeed: fc.array(fc.boolean(), { minLength: members.length, maxLength: members.length }),
          mode: fc.constantFrom('equal', 'fixed', 'percent'),
          cuts: fc.array(fraction, { minLength: 60, maxLength: 60 }),
          pick: fc.nat(),
        }),
        { minLength: 1, maxLength: 12 },
      ),
      tax: fc.option(fc.record({ amount: fc.integer({ min: 1, max: 100_000 }), equal: fc.boolean() })),
      tip: fc.option(fc.record({ amount: fc.integer({ min: 1, max: 100_000 }), equal: fc.boolean() })),
      discountFrac: fc.option(fraction),
      payerSeed: fc.array(fc.boolean(), { minLength: members.length, maxLength: members.length }),
      payerCuts: fc.array(fraction, { minLength: 60, maxLength: 60 }),
    })
    .map((g): ExpenseInput => {
      const items: ExpenseItem[] = g.items.map((it, index) => {
        let beneficiaries = members.filter((_, i) => it.benefSeed[i]).map((m) => m.uid);
        if (beneficiaries.length === 0) beneficiaries = [members[it.pick % members.length]!.uid];
        if (it.personal) beneficiaries = [beneficiaries[it.pick % beneficiaries.length]!];
        const discountMinor = Math.floor(it.discountFrac * it.gross);
        const net = it.gross - discountMinor;
        let allocation: Allocation = { mode: 'equal' };
        if (it.mode === 'fixed') {
          const amounts = splitInteger(net, it.cuts, beneficiaries.length);
          allocation = { mode: 'fixed', shares: beneficiaries.map((uid, i) => ({ uid, amountMinor: amounts[i]! })) };
        } else if (it.mode === 'percent') {
          const bps = splitInteger(10_000, it.cuts, beneficiaries.length);
          allocation = { mode: 'percent', shares: beneficiaries.map((uid, i) => ({ uid, bp: bps[i]! })) };
        }
        return {
          id: `item-${index}`,
          index,
          grossMinor: it.gross,
          discountMinor,
          classification: it.personal ? 'personal' : 'shared',
          beneficiaries,
          allocation,
        };
      });
      const itemsNet = sum(items.map((i) => i.grossMinor - i.discountMinor));
      const adjustments: GeneralAdjustment[] = [];
      if (g.tax) adjustments.push({ kind: 'tax', amountMinor: g.tax.amount, mode: g.tax.equal ? 'equal' : 'proportional' });
      if (g.tip) adjustments.push({ kind: 'tip', amountMinor: g.tip.amount, mode: g.tip.equal ? 'equal' : 'proportional' });
      const generalDiscount = g.discountFrac === null ? 0 : Math.floor(g.discountFrac * itemsNet);
      if (generalDiscount > 0 && itemsNet > 0) {
        adjustments.push({ kind: 'discount', amountMinor: generalDiscount, mode: 'proportional' });
      }
      const total = itemsNet + (g.tax?.amount ?? 0) + (g.tip?.amount ?? 0) - generalDiscount;
      let payerUids = members.filter((_, i) => g.payerSeed[i]).map((m) => m.uid);
      if (payerUids.length === 0) payerUids = [members[0]!.uid];
      payerUids = payerUids.slice(0, Math.max(1, Math.min(payerUids.length, total)));
      // Split the total so every payer contributes at least one minor unit.
      const extra = splitInteger(total - payerUids.length, g.payerCuts, payerUids.length);
      const payers = payerUids.map((uid, i) => ({ uid, amountMinor: 1 + extra[i]! }));
      return { seq, totalMinor: total, payers, splitMode: 'items', items, adjustments, members };
    })
    .filter((e) => {
      const itemsNet = sum(e.items.map((i) => i.grossMinor - i.discountMinor));
      const needsConsumption = e.adjustments.some((a) => a.mode === 'proportional');
      return e.totalMinor > 0 && e.totalMinor >= e.payers.length && !(needsConsumption && itemsNet === 0);
    });

const membersArb = fc.integer({ min: 1, max: 50 }).map((n) =>
  Array.from({ length: n }, (_, i): Member => ({ uid: `m${String(i).padStart(2, '0')}`, joinOrder: i })),
);

const tripArb = membersArb.chain((members) =>
  fc.record({
    members: fc.constant(members),
    expenses: fc.array(fc.nat(), { minLength: 1, maxLength: 6 }).chain((seeds) =>
      fc.tuple(...seeds.map((_, i) => expenseArb(members, i + 1))),
    ),
    payments: fc.array(
      fc.record({
        from: fc.nat(),
        to: fc.nat(),
        amount: fc.integer({ min: 1, max: 500_000 }),
        status: fc.constantFrom('pending', 'confirmed', 'rejected'),
      }),
      { maxLength: 5 },
    ),
    voidMask: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    shuffleSeed: fc.nat(),
  }),
);

function paymentsOf(members: Member[], raw: { from: number; to: number; amount: number; status: Payment['status'] }[]): Payment[] {
  return raw
    .map((p) => ({
      fromUid: members[p.from % members.length]!.uid,
      toUid: members[p.to % members.length]!.uid,
      amountMinor: p.amount,
      status: p.status,
    }))
    .filter((p) => p.fromUid !== p.toUid);
}

describe('propiedades del motor financiero', () => {
  it('cada gasto concilia: Σ cargos = total, Σ netos = 0, neto = pagado − consumido', () => {
    fc.assert(
      fc.property(membersArb.chain((ms) => expenseArb(ms, 1)), (input) => {
        const r = computeExpense(input);
        const charges = Object.values(r.chargesByMember);
        expect(sum(charges.map((c) => c.netMinor))).toBe(input.totalMinor);
        for (const c of charges) expect(c.sharedMinor + c.personalMinor).toBe(c.netMinor);
        expect(sum(Object.values(r.ledgerEffect.netByMember))).toBe(0);
        for (const m of input.members) {
          const paid = sum(input.payers.filter((p) => p.uid === m.uid).map((p) => p.amountMinor));
          const consumed = r.chargesByMember[m.uid]?.netMinor ?? 0;
          expect(r.ledgerEffect.netByMember[m.uid] ?? 0).toBe(paid - consumed);
        }
        // Pairwise debts net out to exactly the same balances (original view consistency).
        expect(netsFromTransfers(originalDebts(r.ledgerEffect, input.members))).toEqual(
          nonZero(Object.fromEntries(Object.entries(r.ledgerEffect.netByMember).map(([k, v]) => [k, -v]))),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('el resultado no depende del orden de la entrada', () => {
    fc.assert(
      fc.property(membersArb.chain((ms) => fc.tuple(expenseArb(ms, 3), fc.nat())), ([input, seed]) => {
        const permuted: ExpenseInput = {
          ...input,
          members: shuffle(input.members, seed),
          payers: shuffle(input.payers, seed + 1),
          items: shuffle(input.items, seed + 2).map((it, k) => ({
            ...it,
            beneficiaries: shuffle(it.beneficiaries, seed + k),
            allocation:
              it.allocation.mode === 'equal'
                ? it.allocation
                : ({ ...it.allocation, shares: shuffle(it.allocation.shares as unknown[], seed + k) } as Allocation),
          })),
        };
        expect(computeExpense(permuted)).toEqual(computeExpense(input));
      }),
      { numRuns: Math.ceil(NUM_RUNS / 5) },
    );
  });

  it('viaje: suma cero, vistas con el mismo neto, simplificada ≤ original, rebuild == incremental', () => {
    fc.assert(
      fc.property(tripArb, ({ members, expenses, payments: rawPayments, voidMask }) => {
        const effects = expenses.map((e) => computeExpense(e).ledgerEffect);
        const payments = paymentsOf(members, rawPayments);

        let incremental: LedgerEffect = EMPTY_LEDGER;
        effects.forEach((e) => (incremental = combineEffects(incremental, e)));
        payments.forEach((p) => (incremental = combineEffects(incremental, paymentEffect(p))));
        effects.forEach((e, i) => {
          if (voidMask[i]) incremental = combineEffects(incremental, negateEffect(e));
        });

        const active = effects.filter((_, i) => !voidMask[i]);
        const rebuilt = rebuildLedger(active, payments);
        expect(rebuilt).toEqual(incremental);
        expect(sum(Object.values(rebuilt.netByMember))).toBe(0);

        const expectedNets = nonZero(
          Object.fromEntries(Object.entries(rebuilt.netByMember).map(([k, v]) => [k, -v])),
        );
        const original = originalDebts(rebuilt, members);
        const simplified = simplifiedDebts(rebuilt, members);
        expect(netsFromTransfers(original)).toEqual(expectedNets);
        expect(netsFromTransfers(simplified)).toEqual(expectedNets);
        expect(simplified.length).toBeLessThanOrEqual(original.length);
        for (const t of [...original, ...simplified]) expect(t.amountMinor).toBeGreaterThan(0);
      }),
      { numRuns: Math.ceil(NUM_RUNS / 10) },
    );
  });
});
