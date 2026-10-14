import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEDGER,
  combineEffects,
  computeExpense,
  negateEffect,
  paymentEffect,
  rebuildLedger,
  type LedgerEffect,
  type Member,
} from '../../src/index.js';

const members: Member[] = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
];

/** Ana debe USD 20.00 a Pedro: Pedro pagó un gasto personal de Ana. */
const anaOwesPedro: LedgerEffect = computeExpense({
  seq: 1,
  totalMinor: 2000,
  payers: [{ uid: 'pedro', amountMinor: 2000 }],
  splitMode: 'total',
  items: [
    {
      id: 't',
      index: 0,
      grossMinor: 2000,
      discountMinor: 0,
      classification: 'personal',
      beneficiaries: ['ana'],
      allocation: { mode: 'equal' },
    },
  ],
  adjustments: [],
  members,
}).ledgerEffect;

describe('paymentEffect', () => {
  it('pagos pendientes y rechazados no cambian saldos (escenario 5)', () => {
    for (const status of ['pending', 'rejected'] as const) {
      const ledger = combineEffects(
        anaOwesPedro,
        paymentEffect({ fromUid: 'ana', toUid: 'pedro', amountMinor: 1000, status }),
      );
      expect(ledger.netByMember).toEqual({ ana: -2000, pedro: 2000 });
    }
  });

  it('un pago confirmado reduce la deuda', () => {
    const ledger = combineEffects(
      anaOwesPedro,
      paymentEffect({ fromUid: 'ana', toUid: 'pedro', amountMinor: 1000, status: 'confirmed' }),
    );
    expect(ledger.netByMember).toEqual({ ana: -1000, pedro: 1000 });
    expect(ledger.pairwise).toEqual({ 'ana>pedro': 2000, 'pedro>ana': 1000 });
  });

  it('rechaza pagos a uno mismo o con importe no positivo', () => {
    expect(() =>
      paymentEffect({ fromUid: 'ana', toUid: 'ana', amountMinor: 10, status: 'confirmed' }),
    ).toThrow();
    expect(() =>
      paymentEffect({ fromUid: 'ana', toUid: 'pedro', amountMinor: 0, status: 'confirmed' }),
    ).toThrow();
  });
});

describe('combine / negate / rebuild', () => {
  it('anular un gasto (negateEffect) devuelve los saldos a cero', () => {
    const ledger = combineEffects(anaOwesPedro, negateEffect(anaOwesPedro));
    expect(ledger).toEqual(EMPTY_LEDGER);
  });

  it('rebuildLedger equivale a combinar efectos incrementalmente', () => {
    const payment = { fromUid: 'ana', toUid: 'pedro', amountMinor: 500, status: 'confirmed' as const };
    const incremental = combineEffects(combineEffects(EMPTY_LEDGER, anaOwesPedro), paymentEffect(payment));
    expect(rebuildLedger([anaOwesPedro], [payment])).toEqual(incremental);
  });
});
