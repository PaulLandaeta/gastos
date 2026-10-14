import { describe, expect, it } from 'vitest';
import {
  computeExpense,
  type ExpenseInput,
  type ExpenseItem,
  type Member,
} from '../../src/index.js';

const members: Member[] = [
  { uid: 'ana', joinOrder: 0 },
  { uid: 'pedro', joinOrder: 1 },
  { uid: 'juan', joinOrder: 2 },
];

function item(partial: Partial<ExpenseItem> & Pick<ExpenseItem, 'grossMinor' | 'beneficiaries'>): ExpenseItem {
  return {
    id: partial.id ?? `i${partial.index ?? 0}`,
    index: partial.index ?? 0,
    discountMinor: 0,
    classification: 'shared',
    allocation: { mode: 'equal' },
    ...partial,
  };
}

function expense(partial: Partial<ExpenseInput>): ExpenseInput {
  return {
    seq: 1,
    totalMinor: 0,
    payers: [],
    splitMode: 'items',
    items: [],
    adjustments: [],
    members,
    ...partial,
  };
}

const errorCode = (code: string) => expect.objectContaining({ code });

describe('computeExpense — reparto por total', () => {
  it('USD 10.00 entre 3 por partes iguales: 3.34/3.33/3.33 en el gasto n.º 1', () => {
    const r = computeExpense(
      expense({
        splitMode: 'total',
        totalMinor: 1000,
        payers: [{ uid: 'ana', amountMinor: 1000 }],
        items: [item({ grossMinor: 1000, beneficiaries: ['ana', 'pedro', 'juan'] })],
      }),
    );
    expect(r.chargesByMember).toEqual({
      ana: { sharedMinor: 334, personalMinor: 0, netMinor: 334 },
      pedro: { sharedMinor: 333, personalMinor: 0, netMinor: 333 },
      juan: { sharedMinor: 333, personalMinor: 0, netMinor: 333 },
    });
    expect(r.ledgerEffect.netByMember).toEqual({ ana: 666, pedro: -333, juan: -333 });
  });

  it('rota la unidad sobrante: el gasto n.º 2 se la asigna al segundo por orden de entrada', () => {
    const r = computeExpense(
      expense({
        seq: 2,
        splitMode: 'total',
        totalMinor: 1000,
        payers: [{ uid: 'ana', amountMinor: 1000 }],
        items: [item({ grossMinor: 1000, beneficiaries: ['juan', 'ana', 'pedro'] })],
      }),
    );
    expect(r.chargesByMember['pedro']?.netMinor).toBe(334);
    expect(r.chargesByMember['ana']?.netMinor).toBe(333);
  });

  it('splitMode total exige exactamente un ítem', () => {
    expect(() =>
      computeExpense(
        expense({
          splitMode: 'total',
          totalMinor: 200,
          payers: [{ uid: 'ana', amountMinor: 200 }],
          items: [
            item({ index: 0, grossMinor: 100, beneficiaries: ['ana'] }),
            item({ index: 1, grossMinor: 100, beneficiaries: ['pedro'] }),
          ],
        }),
      ),
    ).toThrowError(errorCode('INVALID_ALLOCATION'));
  });
});

describe('computeExpense — factura mixta y pagadores', () => {
  it('ítem compartido + personal pagado por otro (escenario 2 de la spec)', () => {
    const r = computeExpense(
      expense({
        totalMinor: 4200,
        payers: [{ uid: 'pedro', amountMinor: 4200 }],
        items: [
          item({ index: 0, grossMinor: 3000, beneficiaries: ['ana', 'pedro'] }),
          item({ index: 1, grossMinor: 1200, beneficiaries: ['ana'], classification: 'personal' }),
        ],
      }),
    );
    expect(r.chargesByMember).toEqual({
      ana: { sharedMinor: 1500, personalMinor: 1200, netMinor: 2700 },
      pedro: { sharedMinor: 1500, personalMinor: 0, netMinor: 1500 },
    });
    expect(r.ledgerEffect.netByMember).toEqual({ ana: -2700, pedro: 2700 });
    expect(r.ledgerEffect.pairwise).toEqual({ 'ana>pedro': 2700 });
  });

  it('gasto personal pagado por otra persona genera deuda sin ser compartido (RF-41)', () => {
    const r = computeExpense(
      expense({
        splitMode: 'total',
        totalMinor: 1200,
        payers: [{ uid: 'pedro', amountMinor: 1200 }],
        items: [item({ grossMinor: 1200, beneficiaries: ['ana'], classification: 'personal' })],
      }),
    );
    expect(r.chargesByMember['ana']).toEqual({ sharedMinor: 0, personalMinor: 1200, netMinor: 1200 });
    expect(r.ledgerEffect.pairwise).toEqual({ 'ana>pedro': 1200 });
  });

  it('varios pagadores: la deuda se reparte en proporción a los aportes', () => {
    const r = computeExpense(
      expense({
        splitMode: 'total',
        totalMinor: 9000,
        payers: [
          { uid: 'ana', amountMinor: 6000 },
          { uid: 'pedro', amountMinor: 3000 },
        ],
        items: [item({ grossMinor: 9000, beneficiaries: ['ana', 'pedro', 'juan'] })],
      }),
    );
    expect(r.ledgerEffect.netByMember).toEqual({ ana: 3000, juan: -3000 });
    expect(r.ledgerEffect.pairwise).toEqual({
      'ana>pedro': 1000,
      'pedro>ana': 2000,
      'juan>ana': 2000,
      'juan>pedro': 1000,
    });
  });

  it('rechaza aportes que no suman el total', () => {
    expect(() =>
      computeExpense(
        expense({
          splitMode: 'total',
          totalMinor: 10000,
          payers: [
            { uid: 'ana', amountMinor: 6000 },
            { uid: 'juan', amountMinor: 3000 },
          ],
          items: [item({ grossMinor: 10000, beneficiaries: ['ana', 'juan'] })],
        }),
      ),
    ).toThrowError(errorCode('NOT_RECONCILED'));
  });

  it('rechaza pagadores que no son miembros aceptados', () => {
    expect(() =>
      computeExpense(
        expense({
          splitMode: 'total',
          totalMinor: 100,
          payers: [{ uid: 'mallory', amountMinor: 100 }],
          items: [item({ grossMinor: 100, beneficiaries: ['ana'] })],
        }),
      ),
    ).toThrowError(errorCode('PAYER_NOT_MEMBER'));
  });

  it('rechaza pagadores duplicados o con importe no positivo', () => {
    const base = { splitMode: 'total' as const, items: [item({ grossMinor: 100, beneficiaries: ['ana'] })] };
    expect(() =>
      computeExpense(
        expense({
          ...base,
          totalMinor: 100,
          payers: [
            { uid: 'ana', amountMinor: 50 },
            { uid: 'ana', amountMinor: 50 },
          ],
        }),
      ),
    ).toThrowError(errorCode('INVALID_ALLOCATION'));
    expect(() =>
      computeExpense(
        expense({
          ...base,
          totalMinor: 100,
          payers: [
            { uid: 'ana', amountMinor: 100 },
            { uid: 'pedro', amountMinor: 0 },
          ],
        }),
      ),
    ).toThrowError(errorCode('INVALID_ALLOCATION'));
  });
});

describe('computeExpense — modos de asignación por ítem', () => {
  const paidByAna = (total: number) => ({ totalMinor: total, payers: [{ uid: 'ana', amountMinor: total }] });

  it('importe fijo', () => {
    const r = computeExpense(
      expense({
        ...paidByAna(1000),
        items: [
          item({
            grossMinor: 1000,
            beneficiaries: ['ana', 'pedro'],
            allocation: {
              mode: 'fixed',
              shares: [
                { uid: 'pedro', amountMinor: 300 },
                { uid: 'ana', amountMinor: 700 },
              ],
            },
          }),
        ],
      }),
    );
    expect(r.chargesByMember['ana']?.netMinor).toBe(700);
    expect(r.chargesByMember['pedro']?.netMinor).toBe(300);
  });

  it('importes fijos que no suman el neto del ítem → NOT_RECONCILED', () => {
    expect(() =>
      computeExpense(
        expense({
          ...paidByAna(1000),
          items: [
            item({
              grossMinor: 1000,
              beneficiaries: ['ana', 'pedro'],
              allocation: {
                mode: 'fixed',
                shares: [
                  { uid: 'ana', amountMinor: 600 },
                  { uid: 'pedro', amountMinor: 300 },
                ],
              },
            }),
          ],
        }),
      ),
    ).toThrowError(errorCode('NOT_RECONCILED'));
  });

  it('porcentajes con 2 decimales (33,33 / 33,33 / 33,34 %)', () => {
    const r = computeExpense(
      expense({
        ...paidByAna(10000),
        items: [
          item({
            grossMinor: 10000,
            beneficiaries: ['ana', 'pedro', 'juan'],
            allocation: {
              mode: 'percent',
              shares: [
                { uid: 'ana', bp: 3333 },
                { uid: 'pedro', bp: 3333 },
                { uid: 'juan', bp: 3334 },
              ],
            },
          }),
        ],
      }),
    );
    expect(r.chargesByMember['juan']?.netMinor).toBe(3334);
    expect(r.chargesByMember['ana']?.netMinor).toBe(3333);
  });

  it.each([
    ['no suman 100,00 %', [5000, 4999]],
    ['más de 2 decimales', [5000.5, 4999.5]],
    ['negativos', [10001, -1]],
  ])('porcentajes inválidos (%s) → INVALID_PERCENT', (_label, bps) => {
    expect(() =>
      computeExpense(
        expense({
          ...paidByAna(1000),
          items: [
            item({
              grossMinor: 1000,
              beneficiaries: ['ana', 'pedro'],
              allocation: {
                mode: 'percent',
                shares: [
                  { uid: 'ana', bp: bps[0]! },
                  { uid: 'pedro', bp: bps[1]! },
                ],
              },
            }),
          ],
        }),
      ),
    ).toThrowError(errorCode('INVALID_PERCENT'));
  });

  it('ítem sin beneficiarios → ITEM_WITHOUT_BENEFICIARY', () => {
    expect(() =>
      computeExpense(expense({ ...paidByAna(100), items: [item({ grossMinor: 100, beneficiaries: [] })] })),
    ).toThrowError(errorCode('ITEM_WITHOUT_BENEFICIARY'));
  });

  it('beneficiario que no es miembro → INVALID_ALLOCATION', () => {
    expect(() =>
      computeExpense(
        expense({ ...paidByAna(100), items: [item({ grossMinor: 100, beneficiaries: ['mallory'] })] }),
      ),
    ).toThrowError(errorCode('INVALID_ALLOCATION'));
  });

  it('ítem personal con más de un beneficiario → INVALID_ALLOCATION', () => {
    expect(() =>
      computeExpense(
        expense({
          ...paidByAna(100),
          items: [item({ grossMinor: 100, beneficiaries: ['ana', 'pedro'], classification: 'personal' })],
        }),
      ),
    ).toThrowError(errorCode('INVALID_ALLOCATION'));
  });

  it('descuento mayor que el importe del ítem → DISCOUNT_EXCEEDS_ITEM', () => {
    expect(() =>
      computeExpense(
        expense({
          ...paidByAna(100),
          items: [item({ grossMinor: 100, discountMinor: 150, beneficiaries: ['ana'] })],
        }),
      ),
    ).toThrowError(errorCode('DISCOUNT_EXCEEDS_ITEM'));
  });

  it('importes no enteros → AMOUNT_NOT_SAFE_INTEGER', () => {
    expect(() =>
      computeExpense(
        expense({ ...paidByAna(100), items: [item({ grossMinor: 99.5, beneficiaries: ['ana'] })] }),
      ),
    ).toThrowError(errorCode('AMOUNT_NOT_SAFE_INTEGER'));
  });
});

describe('computeExpense — ajustes generales', () => {
  it('impuesto proporcional, propina equitativa y descuento general sin doble aplicación (escenario 4)', () => {
    const r = computeExpense(
      expense({
        totalMinor: 10000,
        payers: [{ uid: 'pedro', amountMinor: 10000 }],
        items: [
          item({ index: 0, grossMinor: 6000, beneficiaries: ['ana', 'pedro', 'juan'] }),
          item({ index: 1, grossMinor: 3000, beneficiaries: ['ana'], classification: 'personal' }),
        ],
        adjustments: [
          { kind: 'tax', amountMinor: 900, mode: 'proportional' },
          { kind: 'tip', amountMinor: 600, mode: 'equal' },
          { kind: 'discount', amountMinor: 500, mode: 'proportional' },
        ],
      }),
    );
    expect(r.chargesByMember).toEqual({
      ana: { sharedMinor: 2169, personalMinor: 3253, netMinor: 5422 },
      pedro: { sharedMinor: 2289, personalMinor: 0, netMinor: 2289 },
      juan: { sharedMinor: 2289, personalMinor: 0, netMinor: 2289 },
    });
  });

  it('descuento por ítem y descuento general se aplican una sola vez', () => {
    const input = expense({
      totalMinor: 3600,
      payers: [{ uid: 'ana', amountMinor: 3600 }],
      items: [item({ grossMinor: 5000, discountMinor: 1000, beneficiaries: ['ana', 'pedro'] })],
      adjustments: [{ kind: 'discount', amountMinor: 400, mode: 'equal' }],
    });
    const r = computeExpense(input);
    expect(r.chargesByMember['ana']?.netMinor).toBe(1800);
    expect(r.chargesByMember['pedro']?.netMinor).toBe(1800);
    expect(() =>
      computeExpense({ ...input, totalMinor: 3200, payers: [{ uid: 'ana', amountMinor: 3200 }] }),
    ).toThrowError(errorCode('NOT_RECONCILED'));
  });

  it('ajuste manual', () => {
    const r = computeExpense(
      expense({
        totalMinor: 1300,
        payers: [{ uid: 'ana', amountMinor: 1300 }],
        items: [item({ grossMinor: 1000, beneficiaries: ['ana', 'pedro'] })],
        adjustments: [
          {
            kind: 'tip',
            amountMinor: 300,
            mode: 'manual',
            manualShares: [
              { uid: 'ana', amountMinor: 100 },
              { uid: 'pedro', amountMinor: 200 },
            ],
          },
        ],
      }),
    );
    expect(r.chargesByMember['ana']?.netMinor).toBe(600);
    expect(r.chargesByMember['pedro']?.netMinor).toBe(700);
  });

  it('ajuste manual que no suma el ajuste → NOT_RECONCILED', () => {
    expect(() =>
      computeExpense(
        expense({
          totalMinor: 1300,
          payers: [{ uid: 'ana', amountMinor: 1300 }],
          items: [item({ grossMinor: 1000, beneficiaries: ['ana', 'pedro'] })],
          adjustments: [
            {
              kind: 'tip',
              amountMinor: 300,
              mode: 'manual',
              manualShares: [{ uid: 'ana', amountMinor: 100 }],
            },
          ],
        }),
      ),
    ).toThrowError(errorCode('NOT_RECONCILED'));
  });

  it('un descuento que deja un cargo negativo → INVALID_ALLOCATION', () => {
    expect(() =>
      computeExpense(
        expense({
          totalMinor: 600,
          payers: [{ uid: 'ana', amountMinor: 600 }],
          items: [
            item({
              grossMinor: 1000,
              beneficiaries: ['ana', 'pedro'],
              allocation: {
                mode: 'fixed',
                shares: [
                  { uid: 'ana', amountMinor: 1000 },
                  { uid: 'pedro', amountMinor: 0 },
                ],
              },
            }),
          ],
          adjustments: [{ kind: 'discount', amountMinor: 400, mode: 'equal' }],
        }),
      ),
    ).toThrowError(errorCode('INVALID_ALLOCATION'));
  });
});

describe('computeExpense — determinismo', () => {
  it('el orden de entrada de miembros, ítems y beneficiarios no altera el resultado', () => {
    const a = expense({
      totalMinor: 1001,
      payers: [
        { uid: 'ana', amountMinor: 500 },
        { uid: 'juan', amountMinor: 501 },
      ],
      items: [
        item({ id: 'x', index: 0, grossMinor: 667, beneficiaries: ['ana', 'pedro', 'juan'] }),
        item({ id: 'y', index: 1, grossMinor: 334, beneficiaries: ['pedro', 'juan'] }),
      ],
    });
    const b: ExpenseInput = {
      ...a,
      members: [...members].reverse(),
      payers: [...a.payers].reverse(),
      items: [...a.items].reverse().map((i) => ({ ...i, beneficiaries: [...i.beneficiaries].reverse() })),
    };
    expect(computeExpense(b)).toEqual(computeExpense(a));
  });
});
