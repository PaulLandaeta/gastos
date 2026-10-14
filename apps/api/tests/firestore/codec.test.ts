import { describe, expect, it } from 'vitest';
import { decodeFields, decodeValue, encodeFields, encodeValue } from '../../src/firestore/codec.js';

describe('Firestore Value codec', () => {
  it('encodes integers as integerValue strings and decodes them back', () => {
    expect(encodeValue(1234)).toEqual({ integerValue: '1234' });
    expect(decodeValue({ integerValue: '-42' })).toBe(-42);
  });

  it('rejects unsafe integers on decode and non-integer numbers on encode', () => {
    expect(() => decodeValue({ integerValue: '9007199254740993' })).toThrow();
    expect(() => encodeValue(1.5)).toThrow();
  });

  it('round-trips strings, booleans, null, arrays and nested maps', () => {
    const data = {
      s: 'hola',
      b: true,
      n: null,
      arr: [1, 'x', { k: false }],
      map: { 'ana>pedro': 2700, nested: { deep: 'yes' } },
    };
    expect(decodeFields(encodeFields(data))).toEqual(data);
  });

  it('encodes Date as timestampValue and decodes to Date', () => {
    const d = new Date('2026-10-13T12:00:00.000Z');
    expect(encodeValue(d)).toEqual({ timestampValue: '2026-10-13T12:00:00.000Z' });
    expect(decodeValue({ timestampValue: '2026-10-13T12:00:00.123456Z' })).toEqual(
      new Date('2026-10-13T12:00:00.123Z'),
    );
  });

  it('skips undefined fields and handles empty arrays/maps', () => {
    expect(encodeFields({ a: undefined, b: [] , c: {} })).toEqual({
      b: { arrayValue: {} },
      c: { mapValue: {} },
    });
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
    expect(decodeValue({ mapValue: {} })).toEqual({});
  });

  it('decodes doubleValue only when it is an integer', () => {
    expect(decodeValue({ doubleValue: 3 })).toBe(3);
    expect(() => decodeValue({ doubleValue: 3.2 })).toThrow();
  });
});
