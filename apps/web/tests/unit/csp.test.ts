import { describe, expect, it } from 'vitest';
import { buildCsp } from '../../config/csp';

const prod = {
  VITE_API_URL: 'https://gastos-api.example.workers.dev/v1',
  VITE_FIREBASE_AUTH_DOMAIN: 'gastos-prod.firebaseapp.com',
  VITE_RECEIPTS_ORIGIN: 'https://s3.us-east-005.backblazeb2.com',
};

const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

describe('content security policy (feature 006, FR-026)', () => {
  it('only allows the app, its API and the services it uses', () => {
    const csp = buildCsp(prod);
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self' https://apis.google.com");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    const connect = directive(csp, 'connect-src');
    for (const origin of ['https://gastos-api.example.workers.dev', 'https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://s3.us-east-005.backblazeb2.com']) {
      expect(connect).toContain(origin);
    }
    expect(directive(csp, 'frame-src')).toContain('https://gastos-prod.firebaseapp.com');
    expect(directive(csp, 'img-src')).toContain('https://s3.us-east-005.backblazeb2.com');
    expect(csp).not.toContain('localhost');
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('adds the local emulators and API only in emulator builds', () => {
    const csp = buildCsp({ ...prod, VITE_API_URL: 'http://localhost:8787/v1', VITE_USE_EMULATORS: 'true' });
    const connect = directive(csp, 'connect-src');
    expect(connect).toContain('http://localhost:8787');
    expect(connect).toContain('http://127.0.0.1:8080');
    expect(connect).toContain('http://127.0.0.1:9099');
    expect(directive(csp, 'img-src')).toContain('http://localhost:8787');
  });
});
