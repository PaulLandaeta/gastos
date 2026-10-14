import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call } from '../helpers/http.js';

const db = new Firestore(env);

beforeAll(clearFirestore);

describe('POST /v1/me/sync', () => {
  it('requires authentication', async () => {
    expect((await call(null, 'POST', '/v1/me/sync')).status).toBe(401);
  });

  it('creates the profile from the token with a normalized email', async () => {
    const res = await call(
      { uid: 'u-sync', email: '  Ana.Perez@Example.COM ', name: 'Ana Pérez' },
      'POST',
      '/v1/me/sync',
    );
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({
      uid: 'u-sync',
      email: 'ana.perez@example.com',
      displayName: 'Ana Pérez',
      emailVerified: true,
      version: 1,
      schemaVersion: 1,
    });
    const doc = await db.get('users/u-sync');
    expect(doc?.data['email']).toBe('ana.perez@example.com');
  });

  it('updates an existing profile and bumps its version', async () => {
    const res = await call({ uid: 'u-sync', email: 'ana.perez@example.com', name: 'Ana P.' }, 'POST', '/v1/me/sync');
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ displayName: 'Ana P.', version: 2 });
    const doc = await db.get('users/u-sync');
    expect(doc?.data['createdAt']).toBeInstanceOf(Date);
    expect((doc?.data['updatedAt'] as Date).getTime()).toBeGreaterThanOrEqual((doc?.data['createdAt'] as Date).getTime());
  });

  it('does not rewrite an unchanged profile', async () => {
    const res = await call({ uid: 'u-sync', email: 'ana.perez@example.com', name: 'Ana P.' }, 'POST', '/v1/me/sync');
    expect(res.json.user.version).toBe(2);
  });
});
