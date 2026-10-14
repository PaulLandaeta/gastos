import { AI_CONSENT_VERSION, type AiConsent } from 'contracts';
import type { Firestore } from '../firestore/client.js';
import { notFound } from '../http/errors.js';

interface StoredConsent {
  version: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const toDto = (c: StoredConsent): AiConsent => ({
  version: c.version,
  acceptedAt: c.acceptedAt ? c.acceptedAt.toISOString() : null,
  revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
});

/** FR-015: explicit, dated and revocable consent stored on the user's profile. */
async function writeConsent(db: Firestore, uid: string, next: (current: StoredConsent | null) => StoredConsent) {
  return db.runTransaction(async (tx) => {
    const path = `users/${uid}`;
    const doc = await tx.get(path);
    if (!doc) throw notFound('Profile');
    const consent = next((doc.data['aiConsent'] as StoredConsent | null | undefined) ?? null);
    tx.update(path, { aiConsent: { ...consent }, version: ((doc.data['version'] as number) ?? 0) + 1, updatedAt: new Date() });
    return { aiConsent: toDto(consent) };
  });
}

export const setAiConsent = (db: Firestore, uid: string, now: Date) =>
  writeConsent(db, uid, () => ({ version: AI_CONSENT_VERSION, acceptedAt: now, revokedAt: null }));

export const revokeAiConsent = (db: Firestore, uid: string, now: Date) =>
  writeConsent(db, uid, (c) => ({ version: c?.version ?? AI_CONSENT_VERSION, acceptedAt: c?.acceptedAt ?? null, revokedAt: now }));
