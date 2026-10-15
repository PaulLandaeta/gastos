import type { Plugin } from 'vite';

/**
 * Feature 006 (FR-026, research R9): Content Security Policy generated at build time from the
 * `VITE_*` configuration and injected as a <meta>. Hosting adds X-Frame-Options (frame-ancestors is
 * ignored in a meta). Dev builds are excluded: the React refresh preamble is an inline script.
 */
export interface CspEnv {
  VITE_API_URL?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_RECEIPTS_ORIGIN?: string;
  VITE_USE_EMULATORS?: string;
}

const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

export function buildCsp(env: CspEnv): string {
  const api = origin(env.VITE_API_URL);
  // Signed receipt URLs (presigned GET/PUT); defaults to any B2 S3 endpoint.
  const receipts = origin(env.VITE_RECEIPTS_ORIGIN) ?? 'https://*.backblazeb2.com';
  const emulators = env.VITE_USE_EMULATORS === 'true' ? ['http://127.0.0.1:8080', 'ws://127.0.0.1:8080', 'http://127.0.0.1:9099'] : [];
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN ? `https://${env.VITE_FIREBASE_AUTH_DOMAIN}` : null;
  const list = (...xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].join(' ');
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': "'self' https://apis.google.com",
    // Inline style attributes (React) and the Firebase auth iframe styles.
    'style-src': "'self' 'unsafe-inline'",
    'img-src': list("'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', receipts, emulators.length ? api : null),
    'font-src': "'self'",
    'connect-src': list(
      "'self'",
      api,
      'https://firestore.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://www.googleapis.com',
      receipts,
      ...emulators,
    ),
    // The Auth emulator serves its sign-in iframe from its own host.
    'frame-src': list(authDomain, 'https://accounts.google.com', 'https://apis.google.com', ...(emulators.length ? ['http://127.0.0.1:9099'] : [])),
    'worker-src': "'self'",
    'manifest-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
}

export function cspPlugin(env: CspEnv): Plugin {
  return {
    name: 'gastos-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(env) }, injectTo: 'head-prepend' },
    ],
  };
}

/** Feature 006 (FR-015): `/version.json` lets the smoke test compare app and API builds. */
export function versionPlugin(version: string): Plugin {
  return {
    name: 'gastos-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
    },
  };
}
