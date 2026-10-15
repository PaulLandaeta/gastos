import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { isEmulator, type Env } from '../env.js';

export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  /** Seconds since epoch of the last sign-in (`auth_time`); sensitive operations require a recent one. */
  authTime: number;
}

const JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

// Cached per isolate; jose handles key rotation and HTTP caching.
let remoteKeySet: JWTVerifyGetKey | null = null;

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid ID token: ${reason}`);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Verifies a Firebase ID token (research R3). Only Google sign-in is accepted.
 * Unsigned tokens from the Auth Emulator are accepted ONLY when ENVIRONMENT=emulator.
 */
export async function verifyIdToken(
  token: string,
  env: Pick<Env, 'ENVIRONMENT' | 'FIREBASE_PROJECT_ID'>,
  opts: { keySet?: JWTVerifyGetKey } = {},
): Promise<AuthUser> {
  const projectId = env.FIREBASE_PROJECT_ID;
  const issuer = `https://securetoken.google.com/${projectId}`;
  let payload: JWTPayload;

  if (isEmulator(env)) {
    try {
      payload = decodeJwt(token);
    } catch {
      throw new InvalidTokenError('malformed');
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== issuer || payload.aud !== projectId) throw new InvalidTokenError('iss/aud');
    if (typeof payload.exp !== 'number' || payload.exp < now) throw new InvalidTokenError('expired');
  } else {
    const keySet = opts.keySet ?? (remoteKeySet ??= createRemoteJWKSet(JWKS_URL));
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer,
        audience: projectId,
        algorithms: ['RS256'],
      }));
    } catch (e) {
      throw new InvalidTokenError(e instanceof Error ? e.name : 'verification failed');
    }
  }

  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 128) throw new InvalidTokenError('sub');
  const authTime = payload['auth_time'];
  if (typeof authTime !== 'number' || authTime > Math.floor(Date.now() / 1000) + 60) {
    throw new InvalidTokenError('auth_time');
  }
  const firebase = payload['firebase'] as { sign_in_provider?: string } | undefined;
  if (firebase?.sign_in_provider !== 'google.com') throw new InvalidTokenError('provider');

  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    uid: sub,
    email: str(payload['email']),
    emailVerified: payload['email_verified'] === true,
    name: str(payload['name']),
    picture: str(payload['picture']),
    authTime,
  };
}
