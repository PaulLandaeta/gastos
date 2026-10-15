export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SmokeOptions {
  appUrl: string;
  apiUrl: string;
  /** Uptime mode: only app and API availability. */
  light?: boolean;
  fetchImpl?: typeof fetch;
}

const EVIL_ORIGIN = 'https://evil.example';

/**
 * Feature 006 (FR-015, FR-023): post-deploy verification and periodic uptime check. Every step is
 * reported; a network failure is a failed step, never a crash.
 */
export async function runSmoke(opts: SmokeOptions): Promise<SmokeCheck[]> {
  const f = opts.fetchImpl ?? fetch;
  const app = opts.appUrl.replace(/\/$/, '');
  const api = opts.apiUrl.replace(/\/$/, '');
  const appOrigin = new URL(app).origin;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(app);
  const checks: SmokeCheck[] = [];
  const step = async (name: string, fn: () => Promise<string | true>) => {
    try {
      const r = await fn();
      checks.push(r === true ? { name, ok: true } : { name, ok: false, detail: r });
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };

  let appHeaders: Headers | null = null;
  await step('La app carga con su política de contenido', async () => {
    const res = await f(`${app}/`);
    appHeaders = res.headers;
    const html = await res.text();
    if (!res.ok) return `HTTP ${res.status}`;
    if (!html.includes('id="root"')) return 'La página no contiene la app';
    if (!/http-equiv="Content-Security-Policy"/i.test(html)) return 'Falta la política de seguridad de contenido';
    return true;
  });

  if (!opts.light) {
    await step('Cabeceras de seguridad de la app', async () => {
      if (local) return true; // vite preview does not send Hosting headers
      const h = appHeaders;
      if (!h) return 'Sin respuesta de la app';
      const missing = [
        h.get('x-frame-options')?.toUpperCase() === 'DENY' ? null : 'X-Frame-Options',
        h.get('strict-transport-security') ? null : 'Strict-Transport-Security',
        h.get('x-content-type-options') === 'nosniff' ? null : 'X-Content-Type-Options',
      ].filter(Boolean);
      return missing.length ? `Faltan: ${missing.join(', ')}` : true;
    });
  }

  let apiVersion: string | null = null;
  await step('La API responde y Firestore es accesible', async () => {
    const res = await f(`${api}/v1/health?deep=1`);
    const body = (await res.json()) as { ok?: boolean; version?: string; firestore?: string };
    apiVersion = body.version ?? null;
    if (!res.ok || !body.ok) return `HTTP ${res.status}, Firestore: ${body.firestore ?? 'desconocido'}`;
    return true;
  });
  if (opts.light) return checks;

  await step('App y API tienen la misma versión', async () => {
    const res = await f(`${app}/version.json`, { cache: 'no-store' });
    const web = ((await res.json()) as { version?: string }).version;
    return web && web === apiVersion ? true : `app ${web ?? '?'} ≠ API ${apiVersion ?? '?'}`;
  });

  const preflight = (origin: string) =>
    f(`${api}/v1/trips`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  await step('CORS acepta el origen de la app', async () => {
    const allowed = (await preflight(appOrigin)).headers.get('access-control-allow-origin');
    return allowed === appOrigin ? true : `access-control-allow-origin: ${allowed ?? '(ausente)'}`;
  });
  await step('CORS rechaza otros orígenes', async () => {
    const allowed = (await preflight(EVIL_ORIGIN)).headers.get('access-control-allow-origin');
    return !allowed || allowed === 'null' ? true : `acepta ${allowed}`;
  });
  await step('La API exige autenticación', async () => {
    const res = await f(`${api}/v1/trips`);
    return res.status === 401 ? true : `HTTP ${res.status} sin token`;
  });
  return checks;
}

export function formatReport(checks: SmokeCheck[]): string {
  return checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join('\n');
}
