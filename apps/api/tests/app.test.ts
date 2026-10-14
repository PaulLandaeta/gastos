import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import { emulatorToken } from './helpers/emulator.js';

describe('HTTP app foundation', () => {
  it('returns 401 UNAUTHENTICATED without token, with error envelope and correlation id', async () => {
    const res = await app.request('/v1/me/sync', { method: 'POST' }, env);
    expect(res.status).toBe(401);
    expect(res.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('reuses a valid incoming correlation id and ignores invalid ones', async () => {
    const id = crypto.randomUUID();
    const res = await app.request('/v1/health', { headers: { 'x-correlation-id': id } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-correlation-id')).toBe(id);
    const res2 = await app.request('/v1/health', { headers: { 'x-correlation-id': 'not-a-uuid' } }, env);
    expect(res2.headers.get('x-correlation-id')).not.toBe('not-a-uuid');
  });

  it('returns 404 NOT_FOUND envelope for unknown routes', async () => {
    const token = emulatorToken({ uid: 'u1', email: 'u1@example.com' });
    const res = await app.request('/v1/nope', { headers: { authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await app.request(
      '/v1/trips',
      { method: 'OPTIONS', headers: { origin: 'http://localhost:5180', 'access-control-request-method': 'POST' } },
      env,
    );
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5180');
    const bad = await app.request(
      '/v1/trips',
      { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } },
      env,
    );
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});
