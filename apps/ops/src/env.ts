import type { Env } from '../../api/src/env.js';

/**
 * Environment for the operations tool. It reuses the API code (Firestore REST client, Identity
 * Toolkit, anonymization), so it builds the same `Env` shape from process variables.
 * Emulator mode needs FIRESTORE_EMULATOR_HOST and a `demo-*` project (same guard as the API).
 */
export function opsEnv(vars: NodeJS.ProcessEnv = process.env): Env {
  const emulator = Boolean(vars['FIRESTORE_EMULATOR_HOST']);
  const projectId = vars['FIREBASE_PROJECT_ID'] ?? (emulator ? 'demo-gastos' : undefined);
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set');
  if (emulator && !projectId.startsWith('demo-')) throw new Error('The emulator only works with demo-* projects');
  if (!emulator && !vars['FIREBASE_SERVICE_ACCOUNT']) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const env: Env = {
    ENVIRONMENT: emulator ? 'emulator' : 'production',
    FIREBASE_PROJECT_ID: projectId,
  };
  if (emulator) {
    env.FIRESTORE_EMULATOR_HOST = vars['FIRESTORE_EMULATOR_HOST']!;
    env.FIREBASE_AUTH_EMULATOR_HOST = vars['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099';
  }
  if (vars['FIREBASE_SERVICE_ACCOUNT']) env.FIREBASE_SERVICE_ACCOUNT = vars['FIREBASE_SERVICE_ACCOUNT'];
  // Receipt storage (only used to re-apply deletions after a restore).
  for (const k of ['B2_BUCKET', 'B2_ENDPOINT', 'B2_REGION', 'B2_KEY_ID', 'B2_APPLICATION_KEY'] as const) {
    if (vars[k]) env[k] = vars[k];
  }
  if (env.B2_BUCKET) env.STORAGE = 'b2';
  return env;
}
