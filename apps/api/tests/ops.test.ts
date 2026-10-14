import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index.js';
import { Firestore, FirestoreError } from '../src/firestore/client.js';
import { call, users } from './helpers/http.js';
import { createTrip, equalExpense, postExpense } from './helpers/trips.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('health (feature 006, FR-022)', () => {
  it('reports version and environment without touching Firestore', async () => {
    const res = await app.request('/v1/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: 'dev', environment: 'emulator' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('?deep=1 checks Firestore and answers 503 when it fails', async () => {
    const ok = await app.request('/v1/health?deep=1', {}, env);
    expect(await ok.json()).toMatchObject({ ok: true, firestore: 'ok' });
    vi.spyOn(Firestore.prototype, 'get').mockRejectedValueOnce(new FirestoreError(503, 'UNAVAILABLE', 'down'));
    const down = await app.request('/v1/health?deep=1', {}, env);
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ ok: false, firestore: 'error' });
  });
});

describe('structured request log without PII (FR-024, SC-009)', () => {
  it('writes one line per request with the route pattern, status, code and duration', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    vi.spyOn(console, 'warn').mockImplementation((l: string) => void lines.push(l));
    vi.spyOn(console, 'error').mockImplementation((l: string) => void lines.push(l));

    const trip = await createTrip(users.ana, { name: 'Ruta Pedro', inviteEmails: ['pedro@example.com'] });
    await postExpense(users.ana, trip.id, { ...equalExpense(users.ana.uid, [users.ana.uid], 12345), description: 'Cena secreta' });
    await call(users.ana, 'GET', `/v1/trips/${trip.id}/nope`);

    const requests = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l['event'] === 'request');
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(requests[0]).toMatchObject({ level: 'info', method: 'POST', route: '/v1/trips', status: 201 });
    expect(requests.find((r) => r['status'] === 404)).toMatchObject({ code: 'NOT_FOUND' });
    for (const r of requests) {
      expect(typeof r['ms']).toBe('number');
      expect(typeof r['correlationId']).toBe('string');
      expect(String(r['route'])).not.toContain(trip.id);
    }
    const all = lines.join('\n');
    for (const pii of ['ana@example.com', 'pedro@example.com', 'Ana', 'Cena secreta', '12345', 'Ruta Pedro']) {
      expect(all, `log leaks ${pii}`).not.toContain(pii);
    }
  });
});

describe('exhausted free-tier quota (FR-031)', () => {
  it('RESOURCE_EXHAUSTED from Firestore becomes 503 SERVICE_UNAVAILABLE with retryAfter', async () => {
    vi.spyOn(Firestore.prototype, 'runTransaction').mockRejectedValueOnce(new FirestoreError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.'));
    const res = await call(users.ana, 'POST', '/v1/trips', { body: { name: 'X', startDate: '2026-11-01', endDate: '2026-11-02', currency: 'USD' } });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { retryAfter: 3600 } });
    expect(res.headers.get('retry-after')).toBe('3600');
  });
});
