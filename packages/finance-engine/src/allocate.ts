import { EngineError, assertSafeMinor, toSafeNumber } from './money.js';

/**
 * Splits `totalMinor` proportionally to `weights` using the largest-remainder method (RF-43).
 *
 * 1. Exact rational shares `total * w_i / W` are computed with bigint.
 * 2. Each share is truncated to the minor unit.
 * 3. Leftover units go to the largest remainders; ties are broken by rotation: index
 *    `rotationOffset mod N` is first, then the following indices cyclically (spec FR-007).
 *
 * Negative totals are allocated on their absolute value and negated, so discounts and refunds
 * round symmetrically. The returned array always sums exactly to `totalMinor`.
 */
export function allocateLargestRemainder(
  totalMinor: number,
  weights: readonly (number | bigint)[],
  rotationOffset: number,
): number[] {
  assertSafeMinor(totalMinor, 'totalMinor');
  const n = weights.length;
  if (n === 0) throw new EngineError('INVALID_ALLOCATION', 'At least one weight is required');

  const w = weights.map((x) => {
    if (typeof x === 'number' && !Number.isSafeInteger(x)) {
      throw new EngineError('INVALID_ALLOCATION', 'Weights must be integers');
    }
    const b = BigInt(x);
    if (b < 0n) throw new EngineError('INVALID_ALLOCATION', 'Weights must not be negative');
    return b;
  });
  const weightSum = w.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) throw new EngineError('INVALID_ALLOCATION', 'Weights must not all be zero');

  const sign = totalMinor < 0 ? -1n : 1n;
  const total = BigInt(totalMinor) * sign;

  const quotients = w.map((wi) => (total * wi) / weightSum);
  const remainders = w.map((wi) => (total * wi) % weightSum);
  let leftover = total - quotients.reduce((a, b) => a + b, 0n);

  const offset = ((rotationOffset % n) + n) % n;
  const rotatedPosition = (i: number) => (i - offset + n) % n;
  const order = [...Array(n).keys()].sort((a, b) => {
    const ra = remainders[a]!;
    const rb = remainders[b]!;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return rotatedPosition(a) - rotatedPosition(b);
  });

  // leftover < number of non-zero remainders, and zero weights always have a zero remainder,
  // so units only ever go to weighted recipients.
  for (const i of order) {
    if (leftover === 0n) break;
    quotients[i] = quotients[i]! + 1n;
    leftover -= 1n;
  }

  return quotients.map((q) => toSafeNumber(q * sign));
}
