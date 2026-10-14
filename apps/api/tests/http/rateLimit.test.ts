import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/errors.js';
import { rateLimit } from '../../src/http/rateLimit.js';

/** In-memory stand-in for the Workers rate limiting binding (limit per key per window). */
function fakeLimiter(limit: number) {
  const counts = new Map<string, number>();
  return {
    limit: async ({ key }: { key: string }) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

function appWith(limiter: ReturnType<typeof fakeLimiter> | undefined, keyOf: (c: { req: { header: (n: string) => string | undefined } }) => string) {
  const app = new Hono();
  app.use('*', rateLimit(() => limiter, keyOf));
  app.get('/x', (c) => c.json({ ok: true }));
  app.onError((err, c) => {
    const e = err as AppError;
    if (e.retryAfter) c.header('retry-after', String(e.retryAfter));
    return c.json(e.toBody(), e.status as 429);
  });
  return app;
}

describe('rate limiting (feature 006, FR-027)', () => {
  it('the 121st request of the same user gets 429 with Retry-After; others are not affected', async () => {
    const app = appWith(fakeLimiter(120), (c) => c.req.header('x-user')!);
    for (let i = 0; i < 120; i++) expect((await app.request('/x', { headers: { 'x-user': 'ana' } })).status).toBe(200);
    const limited = await app.request('/x', { headers: { 'x-user': 'ana' } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(((await limited.json()) as { error: { code: string; details: { retryAfter: number } } }).error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfter: 60 },
    });
    expect((await app.request('/x', { headers: { 'x-user': 'pedro' } })).status).toBe(200);
  });

  it('without a binding (emulator, tests) nothing is limited', async () => {
    const app = appWith(undefined, () => 'ip');
    for (let i = 0; i < 200; i++) expect((await app.request('/x')).status).toBe(200);
  });
});
