import { describe, expect, it, vi } from 'vitest';
import { Email } from 'contracts';
import { log } from '../src/http/log.js';
import { call, users } from './helpers/http.js';

describe('security hardening', () => {
  it('rejects path parameters that could escape the document path', async () => {
    for (const path of ['/v1/trips/a%2Fmembers%2Fuid-ana', '/v1/trips/..%2F..', '/v1/trips/%20x/balances']) {
      const res = await call(users.ana, 'GET', path);
      expect(res.status, path).toBe(404);
      expect(res.json.error.code).toBe('NOT_FOUND');
    }
  });

  it('e-mails with "/" are invalid (they would break document paths)', () => {
    expect(Email.safeParse('a/b@example.com').success).toBe(false);
    expect(Email.safeParse('ana@example.com').success).toBe(true);
  });

  it('structured logs never contain e-mail addresses', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log('error', 'unhandled_error', { message: 'no entity: invitations/ana@example.com/trips/t1' });
    const line = String(spy.mock.calls[0]?.[0]);
    spy.mockRestore();
    expect(line).not.toContain('ana@example.com');
    expect(line).toContain('a***@example.com');
  });
});
