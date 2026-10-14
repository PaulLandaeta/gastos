import { env } from 'cloudflare:workers';

const PROJECT = 'demo-gastos';

/** Deletes every document in the Firestore emulator (test isolation between files). */
export async function clearFirestore(): Promise<void> {
  const res = await fetch(
    `http://${env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`Could not clear emulator: ${res.status}`);
}

function base64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export interface TestUser {
  uid: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  provider?: string;
}

/** Unsigned Firebase-like ID token, accepted only when ENVIRONMENT=emulator. */
export function emulatorToken(user: TestUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      auth_time: now - 10,
      iat: now - 10,
      exp: now + 3600,
      sub: user.uid,
      user_id: user.uid,
      email: user.email,
      email_verified: user.emailVerified ?? true,
      name: user.name ?? user.uid,
      firebase: { sign_in_provider: user.provider ?? 'google.com', identities: {} },
    }),
  );
  return `${header}.${payload}.`;
}
