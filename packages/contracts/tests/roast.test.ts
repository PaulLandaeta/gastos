import { describe, expect, it } from 'vitest';
import { UpdateTripBody } from '../src/index.js';

describe('spicy mode contract (feature 007, RF-57)', () => {
  it('accepts spicyMode as the only change', () => {
    expect(UpdateTripBody.safeParse({ expectedVersion: 3, spicyMode: true }).success).toBe(true);
    expect(UpdateTripBody.safeParse({ expectedVersion: 3, spicyMode: false }).success).toBe(true);
  });

  it('rejects a non-boolean value and an empty change', () => {
    expect(UpdateTripBody.safeParse({ expectedVersion: 3, spicyMode: 'si' }).success).toBe(false);
    expect(UpdateTripBody.safeParse({ expectedVersion: 3 }).success).toBe(false);
  });
});
