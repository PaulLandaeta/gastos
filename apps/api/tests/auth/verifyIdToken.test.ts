import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyIdToken } from '../../src/auth/verifyIdToken.js';
import { emulatorToken } from '../helpers/emulator.js';

const PROJECT = 'demo-gastos';
const prodEnv = { ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: PROJECT };
const emuEnv = { ENVIRONMENT: 'emulator', FIREBASE_PROJECT_ID: PROJECT };

let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  keySet = createLocalJWKSet({ keys: [jwk] });
});

async function sign(overrides: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: 'ana@example.com',
    email_verified: true,
    name: 'Ana',
    auth_time: now - 5,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('uid-ana')
    .setIssuer(opts.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(opts.aud ?? PROJECT)
    .setIssuedAt(now - 5)
    .setExpirationTime(opts.exp ?? now + 3600)
    .sign(privateKey);
}

describe('verifyIdToken', () => {
  it('accepts a valid RS256 Google token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = await verifyIdToken(await sign({ auth_time: now - 5 }), prodEnv, { keySet });
    expect(user).toEqual({
      uid: 'uid-ana',
      email: 'ana@example.com',
      emailVerified: true,
      name: 'Ana',
      picture: null,
      authTime: now - 5,
    });
  });

  it('rejects wrong audience, issuer, expired tokens and non-Google providers', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyIdToken(await sign({}, { aud: 'other' }), prodEnv, { keySet })).rejects.toThrow();
    await expect(verifyIdToken(await sign({}, { iss: 'https://evil' }), prodEnv, { keySet })).rejects.toThrow();
    await expect(verifyIdToken(await sign({}, { exp: now - 10 }), prodEnv, { keySet })).rejects.toThrow();
    await expect(
      verifyIdToken(await sign({ firebase: { sign_in_provider: 'password' } }), prodEnv, { keySet }),
    ).rejects.toThrow();
    await expect(verifyIdToken(await sign({ auth_time: now + 600 }), prodEnv, { keySet })).rejects.toThrow();
  });

  it('rejects unsigned tokens outside the emulator', async () => {
    const token = emulatorToken({ uid: 'uid-ana', email: 'ana@example.com' });
    await expect(verifyIdToken(token, prodEnv, { keySet })).rejects.toThrow();
  });

  it('accepts unsigned tokens only in the emulator, still checking claims', async () => {
    const token = emulatorToken({ uid: 'uid-ana', email: 'Ana@Example.com', emailVerified: false });
    const user = await verifyIdToken(token, emuEnv);
    expect(user.uid).toBe('uid-ana');
    expect(user.emailVerified).toBe(false);
    await expect(
      verifyIdToken(emulatorToken({ uid: 'x', email: 'x@example.com', provider: 'anonymous' }), emuEnv),
    ).rejects.toThrow();
    await expect(verifyIdToken('garbage', emuEnv)).rejects.toThrow();
  });
});

describe('emulator mode hardening', () => {
  it('ignores ENVIRONMENT=emulator for non demo- projects (unsigned tokens rejected)', async () => {
    const token = emulatorToken({ uid: 'uid-ana', email: 'ana@example.com' });
    await expect(
      verifyIdToken(token, { ENVIRONMENT: 'emulator', FIREBASE_PROJECT_ID: 'real-project' }, { keySet }),
    ).rejects.toThrow();
  });
});
