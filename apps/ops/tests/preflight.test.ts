import { describe, expect, it } from 'vitest';
import { checkConfig, stripJsonComments } from '../src/preflight.js';

const wrangler = (vars: Record<string, string>) => `{
  // comment with "quotes" and https://example.com
  "name": "gastos-viaje-api",
  "vars": ${JSON.stringify(vars)},
  "env": { "emulator": { "vars": { "ALLOWED_ORIGINS": "http://localhost:5180" } } }
}`;

const goodVars = {
  ENVIRONMENT: 'production',
  FIREBASE_PROJECT_ID: 'gastos-prod',
  ALLOWED_ORIGINS: 'https://gastos-prod.web.app',
  AI_PROVIDER: 'gemini',
  GEMINI_MODEL: 'gemini-flash-latest',
  STORAGE: 'b2',
  B2_BUCKET: 'gastos-receipts',
  B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
  B2_REGION: 'us-east-005',
  API_VERSION: 'dev',
};
const goodWeb = {
  VITE_FIREBASE_API_KEY: 'AIza…',
  VITE_FIREBASE_AUTH_DOMAIN: 'gastos-prod.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'gastos-prod',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
  VITE_API_URL: 'https://gastos-viaje-api.example.workers.dev/v1',
};
const goodSecrets = ['FIREBASE_SERVICE_ACCOUNT', 'GEMINI_API_KEY', 'B2_KEY_ID', 'B2_APPLICATION_KEY'];
const firebaserc = JSON.stringify({ projects: { default: 'demo-gastos', prod: 'gastos-prod' } });

describe('preflight (feature 006, FR-014)', () => {
  it('strips JSONC comments without touching strings', () => {
    expect(JSON.parse(stripJsonComments('{ "a": "http://x//y", /* c */ "b": 1 // end\n}'))).toEqual({ a: 'http://x//y', b: 1 });
  });

  it('accepts a complete production configuration', () => {
    expect(checkConfig({ wrangler: wrangler(goodVars), webEnv: goodWeb, secrets: goodSecrets, firebaserc })).toEqual([]);
  });

  it('detects placeholders, missing variables, missing secrets and inconsistent projects', () => {
    const problems = checkConfig({
      wrangler: wrangler({ ...goodVars, B2_BUCKET: 'REPLACE_WITH_BUCKET', ALLOWED_ORIGINS: 'http://localhost:5180' }),
      webEnv: { ...goodWeb, VITE_API_URL: '', VITE_USE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'other' },
      secrets: ['FIREBASE_SERVICE_ACCOUNT'],
      firebaserc: JSON.stringify({ projects: { default: 'demo-gastos' } }),
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'wrangler.jsonc: B2_BUCKET todavía tiene un valor de ejemplo (REPLACE_WITH…)',
        'wrangler.jsonc: ALLOWED_ORIGINS debe contener solo orígenes https',
        'apps/web/.env.production: falta VITE_API_URL',
        'apps/web/.env.production: VITE_USE_EMULATORS no puede ser true en producción',
        'apps/web/.env.production: VITE_FIREBASE_PROJECT_ID (other) no coincide con FIREBASE_PROJECT_ID (gastos-prod)',
        'Falta el secreto del Worker GEMINI_API_KEY',
        'Falta el secreto del Worker B2_KEY_ID',
        '.firebaserc: falta el alias "prod" con el proyecto de producción',
      ]),
    );
  });

  it('reports a missing web env file and skips secrets when they could not be listed', () => {
    const problems = checkConfig({ wrangler: wrangler(goodVars), webEnv: null, secrets: null, firebaserc });
    expect(problems).toEqual(['Falta apps/web/.env.production (copia apps/web/.env.production.example)']);
  });
});
