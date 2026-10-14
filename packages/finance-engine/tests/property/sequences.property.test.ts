import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEDGER,
  combineEffects,
  computeExpense,
  itemChargesByMember,
  negateEffect,
  paymentEffect,
  rebuildLedger,
  refundEffect,
  type ExpenseInput,
  type LedgerEffect,
  type Member,
} from '../../src/index.js';

const members: Member[] = ['a', 'b', 'c', 'd'].map((uid, joinOrder) => ({ uid, joinOrder }));

function expense(seq: number, total: number, payer: number, benefMask: number): ExpenseInput {
  let beneficiaries = members.filter((_, i) => benefMask & (1 << i)).map((m) => m.uid);
  if (beneficiaries.length === 0) beneficiaries = ['a'];
  return {
    seq,
    totalMinor: total,
    payers: [{ uid: members[payer % 4]!.uid, amountMinor: total }],
    splitMode: 'items',
    items: [{ id: 'i', index: 0, grossMinor: total, discountMinor: 0, classification: 'shared', beneficiaries, allocation: { mode: 'equal' } }],
    adjustments: [],
    members,
  };
}

type Op =
  | { kind: 'create'; total: number; payer: number; mask: number }
  | { kind: 'edit'; target: number; total: number; payer: number; mask: number }
  | { kind: 'toggle'; target: number }
  | { kind: 'refund'; target: number; frac: number; recipient: number }
  | { kind: 'pay'; from: number; to: number; amount: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), total: fc.integer({ min: 1, max: 100_000 }), payer: fc.nat(), mask: fc.nat() }),
  fc.record({ kind: fc.constant('edit' as const), target: fc.nat(), total: fc.integer({ min: 1, max: 100_000 }), payer: fc.nat(), mask: fc.nat() }),
  fc.record({ kind: fc.constant('toggle' as const), target: fc.nat() }),
  fc.record({ kind: fc.constant('refund' as const), target: fc.nat(), frac: fc.double({ min: 0.01, max: 0.5, noNaN: true }), recipient: fc.nat() }),
  fc.record({ kind: fc.constant('pay' as const), from: fc.nat(), to: fc.nat(), amount: fc.integer({ min: 1, max: 50_000 }) }),
);

interface State {
  input: ExpenseInput;
  effect: LedgerEffect;
  refunds: LedgerEffect[];
  refunded: number;
  active: boolean;
}

describe('sequences of create/edit/void/restore/refund/payment', () => {
  it('incremental ledger always equals the rebuild and sums to zero', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const expenses: State[] = [];
        const payments: LedgerEffect[] = [];
        let ledger: LedgerEffect = EMPTY_LEDGER;
        for (const op of ops) {
          if (op.kind === 'create') {
            const input = expense(expenses.length + 1, op.total, op.payer, op.mask);
            const effect = computeExpense(input).ledgerEffect;
            expenses.push({ input, effect, refunds: [], refunded: 0, active: true });
            ledger = combineEffects(ledger, effect);
          } else if (op.kind === 'edit' && expenses.length) {
            const e = expenses[op.target % expenses.length]!;
            if (!e.active || e.refunded > 0) continue;
            const input = expense(e.input.seq, op.total, op.payer, op.mask);
            const effect = computeExpense(input).ledgerEffect;
            ledger = combineEffects(ledger, negateEffect(e.effect), effect);
            Object.assign(e, { input, effect });
          } else if (op.kind === 'toggle' && expenses.length) {
            const e = expenses[op.target % expenses.length]!;
            const all = combineEffects(e.effect, ...e.refunds);
            ledger = combineEffects(ledger, e.active ? negateEffect(all) : all);
            e.active = !e.active;
          } else if (op.kind === 'refund' && expenses.length) {
            const e = expenses[op.target % expenses.length]!;
            const max = e.input.totalMinor - e.refunded;
            const amount = Math.floor(max * op.frac);
            if (!e.active || amount <= 0) continue;
            const r = refundEffect({
              amountMinor: amount,
              recipientUid: members[op.recipient % 4]!.uid,
              itemCharges: itemChargesByMember(e.input, 'i'),
              rotation: e.input.seq - 1,
              members,
            });
            e.refunds.push(r.ledgerEffect);
            e.refunded += amount;
            ledger = combineEffects(ledger, r.ledgerEffect);
          } else if (op.kind === 'pay') {
            const from = members[op.from % 4]!.uid;
            const to = members[op.to % 4]!.uid;
            if (from === to) continue;
            const p = paymentEffect({ fromUid: from, toUid: to, amountMinor: op.amount, status: 'confirmed' });
            payments.push(p);
            ledger = combineEffects(ledger, p);
          }
          const rebuilt = combineEffects(
            rebuildLedger(expenses.filter((e) => e.active).flatMap((e) => [e.effect, ...e.refunds]), []),
            ...payments,
          );
          expect(ledger).toEqual(rebuilt);
          expect(Object.values(ledger.netByMember).reduce((x, y) => x + y, 0)).toBe(0);
        }
      }),
      { numRuns: 1500 },
    );
  });
});
