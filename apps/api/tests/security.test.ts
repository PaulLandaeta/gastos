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

describe('feature 004 hardening', () => {
  it('local blob store and the retention trigger do not exist outside the emulator', async () => {
    const { env } = await import('cloudflare:workers');
    const { app } = await import('../src/index.js');
    const prod = { ...env, ENVIRONMENT: 'production' };
    expect((await app.request('/local-blobs/abc.def', { method: 'GET' }, prod)).status).toBe(404);
    expect((await app.request('/local-admin/run-retention', { method: 'POST' }, prod)).status).toBe(404);
  });

  it('emulator-only providers refuse to start in production', async () => {
    const { createAiProvider } = await import('../src/providers/ai.js');
    const { createStorageProvider } = await import('../src/providers/storage.js');
    const prod = { ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'p' };
    expect(() => createAiProvider({ ...prod, AI_PROVIDER: 'fake' })).toThrow();
    expect(() => createStorageProvider({ ...prod, STORAGE: 'local' })).toThrow();
    expect(() => createAiProvider({ ...prod, AI_PROVIDER: 'gemini' })).toThrow(/not configured/);
  });

  it('scan failures log the error class only, never receipt content', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log('warn', 'scan_failed', { tripId: 't', scanId: 's', provider: 'fake', code: 'AI_UNAVAILABLE' });
    const line = String(spy.mock.calls[0]?.[0]);
    spy.mockRestore();
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(['code', 'event', 'level', 'provider', 'scanId', 'tripId']);
  });
});
