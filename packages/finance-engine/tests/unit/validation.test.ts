import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES,
  computeExpense,
  isCurrency,
  memberRanking,
  originalDebts,
  type ExpenseInput,
  type Member,
} from '../../src/index.js';

const members: Member[] = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
];

const base = (): ExpenseInput => ({
  seq: 1,
  totalMinor: 100,
  payers: [{ uid: 'ana', amountMinor: 100 }],
  splitMode: 'items',
  items: [
    {
      id: 'i',
      index: 0,
      grossMinor: 100,
      discountMinor: 0,
      classification: 'shared',
      beneficiaries: ['ana', 'pedro'],
      allocation: { mode: 'equal' },
    },
  ],
  adjustments: [],
  members,
});

const code = (c: string) => expect.objectContaining({ code: c });

describe('validación de entrada', () => {
  it.each([0, -1, 1.5])('seq inválido (%s)', (seq) => {
    expect(() => computeExpense({ ...base(), seq })).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('total no positivo', () => {
    expect(() => computeExpense({ ...base(), totalMinor: 0, payers: [] })).toThrowError(
      code('INVALID_ALLOCATION'),
    );
  });

  it('sin pagadores', () => {
    expect(() => computeExpense({ ...base(), payers: [] })).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('sin ítems', () => {
    expect(() => computeExpense({ ...base(), items: [] })).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('índices de ítem duplicados o negativos', () => {
    const it0 = base().items[0]!;
    expect(() =>
      computeExpense({ ...base(), totalMinor: 200, payers: [{ uid: 'ana', amountMinor: 200 }], items: [it0, { ...it0, id: 'j' }] }),
    ).toThrowError(code('INVALID_ALLOCATION'));
    expect(() => computeExpense({ ...base(), items: [{ ...it0, index: -1 }] })).toThrowError(
      code('INVALID_ALLOCATION'),
    );
  });

  it('beneficiarios duplicados', () => {
    const it0 = base().items[0]!;
    expect(() =>
      computeExpense({ ...base(), items: [{ ...it0, beneficiaries: ['ana', 'ana'] }] }),
    ).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('importes negativos en ítems', () => {
    const it0 = base().items[0]!;
    expect(() => computeExpense({ ...base(), items: [{ ...it0, discountMinor: -5 }] })).toThrowError(
      code('INVALID_ALLOCATION'),
    );
  });

  it('cuotas que no cubren a cada beneficiario exactamente una vez', () => {
    const it0 = base().items[0]!;
    expect(() =>
      computeExpense({
        ...base(),
        items: [{ ...it0, allocation: { mode: 'fixed', shares: [{ uid: 'ana', amountMinor: 100 }] } }],
      }),
    ).toThrowError(code('INVALID_ALLOCATION'));
    expect(() =>
      computeExpense({
        ...base(),
        items: [
          {
            ...it0,
            allocation: {
              mode: 'fixed',
              shares: [
                { uid: 'ana', amountMinor: 50 },
                { uid: 'juan', amountMinor: 50 },
              ],
            },
          },
        ],
      }),
    ).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('ajustes con importe no positivo', () => {
    expect(() =>
      computeExpense({ ...base(), adjustments: [{ kind: 'tip', amountMinor: 0, mode: 'equal' }] }),
    ).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('ajuste proporcional sin consumo', () => {
    const it0 = base().items[0]!;
    expect(() =>
      computeExpense({
        ...base(),
        items: [{ ...it0, grossMinor: 0 }],
        adjustments: [{ kind: 'tax', amountMinor: 100, mode: 'proportional' }],
      }),
    ).toThrowError(code('INVALID_ALLOCATION'));
  });

  it('ajuste manual a no beneficiarios, duplicado o sin cuotas', () => {
    const tip = (manualShares?: { uid: string; amountMinor: number }[]) => ({
      ...base(),
      totalMinor: 110,
      payers: [{ uid: 'ana', amountMinor: 110 }],
      adjustments: [{ kind: 'tip' as const, amountMinor: 10, mode: 'manual' as const, ...(manualShares ? { manualShares } : {}) }],
    });
    expect(() => computeExpense(tip([{ uid: 'juan', amountMinor: 10 }]))).toThrowError(code('INVALID_ALLOCATION'));
    expect(() =>
      computeExpense(tip([{ uid: 'ana', amountMinor: 5 }, { uid: 'ana', amountMinor: 5 }])),
    ).toThrowError(code('INVALID_ALLOCATION'));
    expect(() => computeExpense(tip())).toThrowError(code('NOT_RECONCILED'));
  });

  it('descuento manual se aplica con signo negativo', () => {
    const r = computeExpense({
      ...base(),
      totalMinor: 90,
      payers: [{ uid: 'ana', amountMinor: 90 }],
      adjustments: [{ kind: 'discount', amountMinor: 10, mode: 'manual', manualShares: [{ uid: 'pedro', amountMinor: 10 }] }],
    });
    expect(r.chargesByMember['pedro']?.netMinor).toBe(40);
    expect(r.chargesByMember['ana']?.netMinor).toBe(50);
  });

  it('varios ajustes del mismo tipo se ordenan de forma estable', () => {
    const r = computeExpense({
      ...base(),
      totalMinor: 103,
      payers: [{ uid: 'ana', amountMinor: 103 }],
      adjustments: [
        { kind: 'tip', amountMinor: 1, mode: 'equal' },
        { kind: 'tax', amountMinor: 1, mode: 'equal' },
        { kind: 'tip', amountMinor: 1, mode: 'equal' },
      ],
    });
    expect(r.chargesByMember['ana']!.netMinor + r.chargesByMember['pedro']!.netMinor).toBe(103);
  });
});

describe('orden de miembros y catálogo', () => {
  it('rechaza miembros duplicados', () => {
    expect(() => memberRanking([...members, { uid: 'ana', joinOrder: 5 }])).toThrowError(
      code('INVALID_ALLOCATION'),
    );
  });

  it('desempata joinOrder iguales por uid', () => {
    const rank = memberRanking([
      { uid: 'z', joinOrder: 1 },
      { uid: 'b', joinOrder: 1 },
      { uid: 'a', joinOrder: 0 },
    ]);
    expect([...rank.keys()]).toEqual(['a', 'b', 'z']);
  });

  it('ordena al final, por uid, a miembros desconocidos (p. ej. anonimizados)', () => {
    const ledger = {
      netByMember: { x2: -1, x1: -1, ana: 2 },
      pairwise: { 'x2>ana': 1, 'x1>ana': 1 },
    };
    expect(originalDebts(ledger, members).map((t) => t.fromUid)).toEqual(['x1', 'x2']);
    const ledger2 = { netByMember: { ana: -1, x9: 1 }, pairwise: { 'ana>x9': 1 } };
    expect(originalDebts(ledger2, members)).toEqual([{ fromUid: 'ana', toUid: 'x9', amountMinor: 1 }]);
  });

  it('el catálogo ISO está ordenado y es consultable', () => {
    expect(CURRENCY_CODES).toContain('USD');
    expect([...CURRENCY_CODES]).toEqual([...CURRENCY_CODES].sort());
    expect(isCurrency('BOB')).toBe(true);
    expect(isCurrency('ABC')).toBe(false);
  });
});
