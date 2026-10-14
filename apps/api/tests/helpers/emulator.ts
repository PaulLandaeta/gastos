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
  /** Seconds since the last sign-in (default 10). */
  signedInSecondsAgo?: number;
}

/** Unsigned Firebase-like ID token, accepted only when ENVIRONMENT=emulator. */
export function emulatorToken(user: TestUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      auth_time: now - (user.signedInSecondsAgo ?? 10),
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

interface RawDoc {
  name: string;
  fields?: Record<string, unknown>;
}

/**
 * Every document in the Firestore emulator, found by walking `listCollectionIds` recursively
 * (feature 006: exhaustive PII search after an account deletion).
 */
export async function allDocuments(): Promise<{ path: string; json: string }[]> {
  const base = `http://${env.FIRESTORE_EMULATOR_HOST}/v1`;
  const root = `projects/${PROJECT}/databases/(default)/documents`;
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const out: { path: string; json: string }[] = [];

  async function collectionIds(parent: string): Promise<string[]> {
    const res = await fetch(`${base}/${parent}:listCollectionIds`, { method: 'POST', headers, body: JSON.stringify({ pageSize: 1000 }) });
    return (((await res.json()) as { collectionIds?: string[] }).collectionIds ?? []);
  }

  async function walk(parent: string): Promise<void> {
    for (const id of await collectionIds(parent)) {
      let pageToken = '';
      do {
        const res = await fetch(`${base}/${parent}/${id}?pageSize=300&showMissing=true${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers });
        const body = (await res.json()) as { documents?: RawDoc[]; nextPageToken?: string };
        for (const d of body.documents ?? []) {
          const path = d.name.slice(root.length + 1);
          if (d.fields) out.push({ path, json: JSON.stringify(d.fields) });
          await walk(d.name.slice(d.name.indexOf('projects/')));
        }
        pageToken = body.nextPageToken ?? '';
      } while (pageToken);
    }
  }

  await walk(root);
  return out;
}
