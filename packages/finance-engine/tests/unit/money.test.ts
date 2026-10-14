import { describe, expect, it } from 'vitest';
import { EngineError, assertSafeMinor, minorUnits } from '../../src/index.js';

describe('minorUnits', () => {
  it('returns ISO 4217 decimals', () => {
    expect(minorUnits('USD')).toBe(2);
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('KWD')).toBe(3);
    expect(minorUnits('BOB')).toBe(2);
  });

  it('rejects unknown currencies', () => {
    expect(() => minorUnits('XXX')).toThrow(EngineError);
    expect(() => minorUnits('usd')).toThrow(EngineError);
  });
});

describe('assertSafeMinor', () => {
  it('accepts safe integers', () => {
    expect(() => assertSafeMinor(0)).not.toThrow();
    expect(() => assertSafeMinor(-150)).not.toThrow();
    expect(() => assertSafeMinor(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });

  it.each([1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (v) => {
    expect(() => assertSafeMinor(v)).toThrowError(
      expect.objectContaining({ code: 'AMOUNT_NOT_SAFE_INTEGER' }),
    );
  });
});
