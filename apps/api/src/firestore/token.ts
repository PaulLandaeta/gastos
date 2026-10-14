import { SignJWT, importPKCS8 } from 'jose';
import { isEmulator, type Env } from '../env.js';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Firestore + Firebase Auth admin (account deletion, feature 006).
const SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit';

// Isolate-level cache: avoids signing a JWT (CPU) on every request (10 ms CPU budget).
let cached: { token: string; expiresAt: number } | null = null;

/** OAuth access token for Firestore REST. The emulator accepts `owner` (bypasses Rules). */
export async function getAccessToken(env: Env, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (isEmulator(env)) return 'owner';
  const now = Date.now();
  if (cached && cached.expiresAt - 5 * 60_000 > now) return cached.token;

  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  const key = await importPKCS8(sa.private_key, 'RS256');
  const iat = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return cached.token;
}
