import { describe, expect, it } from 'vitest';
import { runSmoke } from '../src/smoke.js';

const APP = 'https://gastos-prod.web.app';
const API = 'https://api.example.workers.dev';

/** Fake deployment answering like Firebase Hosting + the Worker. */
function fakeFetch(over: { apiVersion?: string; cors?: 'ok' | 'open'; frame?: boolean; healthDown?: boolean } = {}) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const origin = new Headers(init?.headers).get('origin');
    if (url.origin === APP && url.pathname === '/') {
      return new Response('<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><div id="root"></div></html>', {
        headers: {
          'content-type': 'text/html',
          'strict-transport-security': 'max-age=31536000',
          'x-content-type-options': 'nosniff',
          ...(over.frame === false ? {} : { 'x-frame-options': 'DENY' }),
        },
      });
    }
    if (url.origin === APP && url.pathname === '/version.json') return Response.json({ version: 'abc123' });
    if (url.pathname === '/v1/health') {
      if (over.healthDown) return Response.json({ ok: false, firestore: 'error' }, { status: 503 });
      return Response.json({ ok: true, version: over.apiVersion ?? 'abc123', environment: 'production', firestore: 'ok' });
    }
    if (init?.method === 'OPTIONS') {
      const allowed = over.cors === 'open' || origin === APP;
      return new Response(null, { status: 204, headers: allowed ? { 'access-control-allow-origin': origin ?? '' } : {} });
    }
    if (url.pathname === '/v1/trips') return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
    return new Response('not found', { status: 404 });
  };
}

describe('post-deploy smoke test (feature 006, FR-015)', () => {
  it('passes against a healthy deployment', async () => {
    const report = await runSmoke({ appUrl: APP, apiUrl: API, fetchImpl: fakeFetch() });
    expect(report.filter((c) => !c.ok)).toEqual([]);
    expect(report.map((c) => c.name)).toEqual([
      'La app carga con su política de contenido',
      'Cabeceras de seguridad de la app',
      'La API responde y Firestore es accesible',
      'App y API tienen la misma versión',
      'CORS acepta el origen de la app',
      'CORS rechaza otros orígenes',
      'La API exige autenticación',
    ]);
  });

  it('names the failing step', async () => {
    const failed = async (o: Parameters<typeof fakeFetch>[0]) =>
      (await runSmoke({ appUrl: APP, apiUrl: API, fetchImpl: fakeFetch(o) })).filter((c) => !c.ok).map((c) => c.name);
    expect(await failed({ apiVersion: 'old' })).toEqual(['App y API tienen la misma versión']);
    expect(await failed({ cors: 'open' })).toEqual(['CORS rechaza otros orígenes']);
    expect(await failed({ frame: false })).toEqual(['Cabeceras de seguridad de la app']);
    expect(await failed({ healthDown: true })).toContain('La API responde y Firestore es accesible');
  });

  it('light mode only checks that app and API are up (uptime)', async () => {
    const report = await runSmoke({ appUrl: APP, apiUrl: API, light: true, fetchImpl: fakeFetch() });
    expect(report.map((c) => c.name)).toEqual(['La app carga con su política de contenido', 'La API responde y Firestore es accesible']);
  });

  it('an unreachable host is a failure, not a crash', async () => {
    const report = await runSmoke({ appUrl: APP, apiUrl: API, light: true, fetchImpl: async () => Promise.reject(new TypeError('fetch failed')) });
    expect(report.every((c) => !c.ok)).toBe(true);
  });
});
