import { isEmulator, type Env } from '../env.js';
import { getAccessToken } from '../firestore/token.js';

/**
 * Firebase Auth admin operations through the Identity Toolkit REST API (feature 006, research R1).
 * Production authenticates with the service-account token (scope `identitytoolkit`); the Auth
 * emulator accepts `Bearer owner`.
 */
function baseUrl(env: Env): string {
  const host =
    isEmulator(env) && env.FIREBASE_AUTH_EMULATOR_HOST
      ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
      : 'https://identitytoolkit.googleapis.com';
  return `${host}/v1/projects/${env.FIREBASE_PROJECT_ID}`;
}

async function post<T>(env: Env, op: string, body: unknown, fetchImpl: typeof fetch): Promise<{ ok: true; body: T } | { ok: false; status: number; message: string }> {
  const token = await getAccessToken(env, fetchImpl);
  const res = await fetchImpl(`${baseUrl(env)}/${op}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true, body: (await res.json()) as T };
  let message = res.statusText;
  try {
    message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    // non-JSON error body
  }
  return { ok: false, status: res.status, message };
}

/** Deletes the Auth account. Idempotent: an account that no longer exists counts as deleted. */
export async function deleteAuthUser(env: Env, uid: string, fetchImpl: typeof fetch = (i, init) => fetch(i, init)): Promise<void> {
  const res = await post(env, 'accounts:delete', { localId: uid }, fetchImpl);
  if (!res.ok && !res.message.includes('USER_NOT_FOUND')) {
    throw new Error(`Auth account deletion failed: ${res.status} ${res.message}`);
  }
}

/** Returns the subset of `uids` that still have an Auth account (batches of 100). */
export async function lookupAuthUsers(env: Env, uids: string[], fetchImpl: typeof fetch = (i, init) => fetch(i, init)): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await post<{ users?: { localId: string }[] }>(env, 'accounts:lookup', { localId: uids.slice(i, i + 100) }, fetchImpl);
    if (!res.ok) {
      if (res.message.includes('USER_NOT_FOUND')) continue;
      throw new Error(`Auth lookup failed: ${res.status} ${res.message}`);
    }
    for (const u of res.body.users ?? []) found.add(u.localId);
  }
  return found;
}
