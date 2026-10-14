import { describe, expect, it } from 'vitest';
import { allocateLargestRemainder } from '../../src/index.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocateLargestRemainder', () => {
  it('splits USD 10.00 among 3 as 3.34/3.33/3.33 with offset 0 (PRD scenario)', () => {
    expect(allocateLargestRemainder(1000, [1, 1, 1], 0)).toEqual([334, 333, 333]);
  });

  it('rotates the extra unit with the offset', () => {
    expect(allocateLargestRemainder(1000, [1, 1, 1], 1)).toEqual([333, 334, 333]);
    expect(allocateLargestRemainder(1000, [1, 1, 1], 2)).toEqual([333, 333, 334]);
    expect(allocateLargestRemainder(1000, [1, 1, 1], 3)).toEqual([334, 333, 333]);
  });

  it('gives a single minor unit to exactly one recipient', () => {
    const r = allocateLargestRemainder(1, [1, 1, 1, 1], 2);
    expect(r).toEqual([0, 0, 1, 0]);
  });

  it('allocates by percentage basis points', () => {
    // 33.33 / 33.33 / 33.34 % of 100.00
    expect(allocateLargestRemainder(10000, [3333, 3333, 3334], 0)).toEqual([3333, 3333, 3334]);
    // 50 % / 50 % of 0.01 → tie broken by rotation
    expect(allocateLargestRemainder(1, [5000, 5000], 1)).toEqual([0, 1]);
  });

  it('prefers the largest remainder before the rotation tie-break', () => {
    // 100 * [1,2] / 3 = 33.33 / 66.67 → remainder of index 1 is larger
    expect(allocateLargestRemainder(100, [1, 2], 0)).toEqual([33, 67]);
  });

  it('is symmetric for negative totals', () => {
    const pos = allocateLargestRemainder(1000, [1, 1, 1], 1);
    const neg = allocateLargestRemainder(-1000, [1, 1, 1], 1);
    expect(neg).toEqual(pos.map((v) => -v));
  });

  it('always sums to the total and supports zero weights', () => {
    const r = allocateLargestRemainder(997, [0, 5, 3, 0, 2], 4);
    expect(sum(r)).toBe(997);
    expect(r[0]).toBe(0);
    expect(r[3]).toBe(0);
  });

  it('rejects invalid weights', () => {
    expect(() => allocateLargestRemainder(100, [], 0)).toThrow();
    expect(() => allocateLargestRemainder(100, [0, 0], 0)).toThrow();
    expect(() => allocateLargestRemainder(100, [-1, 2], 0)).toThrow();
    expect(() => allocateLargestRemainder(100, [1.5, 2], 0)).toThrow();
  });
});
