import { describe, expect, it } from 'vitest';
import { CreateTripBody, Email, IsoDate, SetRoleBody, TripStatusBody, isCurrency, isErrorCode, normalizeEmail } from '../src/index.js';

describe('contracts', () => {
  it('normalizes e-mails (trim + lowercase) as Security Rules expect', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(Email.parse(' Pedro@Example.com')).toBe('pedro@example.com');
  });

  it('validates real calendar dates only', () => {
    expect(IsoDate.safeParse('2026-02-28').success).toBe(true);
    expect(IsoDate.safeParse('2026-02-30').success).toBe(false);
    expect(IsoDate.safeParse('26-2-1').success).toBe(false);
  });

  it('CreateTripBody: end date not before start, ISO currency, default invitees', () => {
    const ok = CreateTripBody.parse({ name: ' Uyuni ', startDate: '2026-11-01', endDate: '2026-11-01', currency: 'BOB' });
    expect(ok).toMatchObject({ name: 'Uyuni', inviteEmails: [] });
    expect(CreateTripBody.safeParse({ ...ok, endDate: '2026-10-31' }).success).toBe(false);
    expect(CreateTripBody.safeParse({ ...ok, currency: 'XXX' }).success).toBe(false);
  });

  it('the creator role cannot be assigned and status actions are closed', () => {
    expect(SetRoleBody.safeParse({ expectedVersion: 1, role: 'creator' }).success).toBe(false);
    expect(TripStatusBody.safeParse({ expectedVersion: 1, action: 'delete' }).success).toBe(false);
  });

  it('re-exports the ISO catalog and error codes', () => {
    expect(isCurrency('USD')).toBe(true);
    expect(isErrorCode('TRIP_NOT_READY')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
  });
});
