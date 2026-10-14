import { describe, expect, it } from 'vitest';
import { addCalendarMonths, attachmentExpiry, isExpiringSoon } from '../src/index.js';

const d = (iso: string) => new Date(iso);

describe('retention dates (RF-53)', () => {
  it.each([
    ['2026-03-31T10:00:00Z', '2026-09-30T10:00:00.000Z'],
    ['2028-02-29T00:00:00Z', '2028-08-29T00:00:00.000Z'],
    ['2026-08-31T23:59:59Z', '2027-02-28T23:59:59.000Z'],
    ['2027-08-31T12:00:00Z', '2028-02-29T12:00:00.000Z'],
    ['2026-10-13T08:30:00Z', '2027-04-13T08:30:00.000Z'],
  ])('%s + 6 months = %s (UTC, clamped to month end)', (from, to) => {
    expect(attachmentExpiry(d(from)).toISOString()).toBe(to);
  });

  it('addCalendarMonths works across years and for other offsets', () => {
    expect(addCalendarMonths(d('2026-12-31T00:00:00Z'), 2).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(addCalendarMonths(d('2026-01-15T00:00:00Z'), 12).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('isExpiringSoon: within 14 days and not yet expired', () => {
    const now = d('2026-10-01T00:00:00Z');
    expect(isExpiringSoon(d('2026-10-10T00:00:00Z'), now)).toBe(true);
    expect(isExpiringSoon(d('2026-10-15T00:00:00Z'), now)).toBe(true);
    expect(isExpiringSoon(d('2026-10-16T00:00:01Z'), now)).toBe(false);
    expect(isExpiringSoon(d('2026-09-30T00:00:00Z'), now)).toBe(false);
  });
});
