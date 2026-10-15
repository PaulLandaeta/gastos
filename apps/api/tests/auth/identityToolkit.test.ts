import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { deleteAuthUser, lookupAuthUsers } from '../../src/auth/identityToolkit.js';

const base = () =>
  `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;

async function createAuthUser(localId: string) {
  const res = await fetch(`${base()}/accounts`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ localId, email: `${localId}@example.com` }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
}

describe('Identity Toolkit (feature 006, RF-56)', () => {
  it('looks up and deletes Auth accounts idempotently', async () => {
    const uid = `uid-itk-${crypto.randomUUID().slice(0, 8)}`;
    await createAuthUser(uid);
    expect(await lookupAuthUsers(env, [uid, 'uid-never-existed'])).toEqual(new Set([uid]));

    await deleteAuthUser(env, uid);
    expect(await lookupAuthUsers(env, [uid])).toEqual(new Set());
    // Deleting an account that no longer exists succeeds (resumable deletion).
    await expect(deleteAuthUser(env, uid)).resolves.toBeUndefined();
  });

  it('returns an empty set without calling Auth when there is nothing to look up', async () => {
    expect(await lookupAuthUsers(env, [])).toEqual(new Set());
  });
});
