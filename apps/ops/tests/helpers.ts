import { app } from '../../api/src/index.js';
import type { Env } from '../../api/src/env.js';

export const PROJECT = 'demo-gastos';
export const FIRESTORE = '127.0.0.1:8080';
export const AUTH = '127.0.0.1:9099';

/** Minimal in-memory stand-in for the Miniflare R2 bucket used by the emulator's local storage. */
const blobs = new Map<string, Uint8Array>();
const memoryBucket = {
  head: async (k: string) => (blobs.has(k) ? { size: blobs.get(k)!.byteLength } : null),
  get: async (k: string) => (blobs.has(k) ? { arrayBuffer: async () => blobs.get(k)!.buffer } : null),
  delete: async (k: string) => void blobs.delete(k),
  put: async (k: string, v: ArrayBuffer) => void blobs.set(k, new Uint8Array(v)),
} as unknown as R2Bucket;

/** API environment running in Node against the emulators (same as `wrangler dev --env emulator`). */
export const apiEnv = {
  LOCAL_BLOBS: memoryBucket,
  ENVIRONMENT: 'emulator',
  FIREBASE_PROJECT_ID: PROJECT,
  FIRESTORE_EMULATOR_HOST: FIRESTORE,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH,
  ALLOWED_ORIGINS: 'http://localhost:5180',
  AI_PROVIDER: 'fake',
  STORAGE: 'local',
  LOCAL_BLOB_SECRET: 'test',
  AI_QUOTA_TRIP_DAY: '20',
  AI_QUOTA_GLOBAL_DAY: '100',
  AI_QUOTA_GLOBAL_MONTH: '1500',
} satisfies Env;

export interface TestUser {
  uid: string;
  email: string;
  name: string;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

export function token(u: TestUser): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64(
    JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      auth_time: now - 10,
      iat: now - 10,
      exp: now + 3600,
      sub: u.uid,
      email: u.email,
      email_verified: true,
      name: u.name,
      firebase: { sign_in_provider: 'google.com' },
    }),
  )}.`;
}

export async function call(u: TestUser, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(
    path,
    {
      method,
      headers: { authorization: `Bearer ${token(u)}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    apiEnv,
  );
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as any };
}

export async function clearFirestore() {
  const res = await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`clear failed ${res.status}`);
}

export async function clearAuth() {
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Creates the Auth emulator account so the post-restore reconciliation sees the user as alive. */
export async function createAuthUser(u: TestUser) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ localId: u.uid, email: u.email, displayName: u.name }),
  });
  if (!res.ok) throw new Error(`auth create failed ${await res.text()}`);
}
