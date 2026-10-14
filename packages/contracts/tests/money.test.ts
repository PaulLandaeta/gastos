import { describe, expect, it } from 'vitest';
import { parseMoneyInput } from '../src/index.js';

describe('parseMoneyInput (no floats)', () => {
  it.each([
    ['10', 2, 'es', 1000],
    ['10.5', 2, 'es', 1050],
    ['10,50', 2, 'es', 1050],
    ['0,01', 2, 'es', 1],
    ['1.234,56', 2, 'es', 123456],
    ['1,234.56', 2, 'en', 123456],
    ['1.234', 2, 'es', 123400],
    ['1,234', 2, 'en', 123400],
    ['1 234,5', 2, 'es', 123450],
    ['1500', 0, 'es', 1500],
    ['1.500', 0, 'es', 1500],
    ['1,250', 3, 'es', 1250],
    ['1.250', 3, 'en', 1250],
    [' 45 ', 2, 'es', 4500],
  ] as const)('%s with %i decimals (%s) → %i', (text, decimals, locale, expected) => {
    expect(parseMoneyInput(text, decimals, locale)).toBe(expected);
  });

  it.each([
    ['', 2],
    ['   ', 2],
    ['-5', 2],
    ['abc', 2],
    ['10.5555', 2],
    ['10,555', 2],
    ['15.5', 0],
    ['1,2,3', 2],
    ['1..2', 2],
    ['99999999999999999', 2],
  ] as const)('rejects %j with %i decimals', (text, decimals) => {
    expect(parseMoneyInput(text, decimals, 'es')).toBeNull();
  });
});
