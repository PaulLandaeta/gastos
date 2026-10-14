import { SCHEMA_VERSION, normalizeEmail } from 'contracts';
import type { AuthUser } from '../auth/verifyIdToken.js';
import type { Firestore } from '../firestore/client.js';
import { AppError } from '../http/errors.js';

export interface ProfileDto {
  uid: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  photoURL: string | null;
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
  version: number;
}

/** Creates or refreshes `users/{uid}` from the verified token (FR-014). */
export async function syncProfile(db: Firestore, user: AuthUser, now = new Date()): Promise<ProfileDto> {
  if (!user.email) throw new AppError('VALIDATION_FAILED', 'The Google account has no e-mail');
  const desired = {
    uid: user.uid,
    displayName: (user.name ?? user.email).slice(0, 100),
    email: normalizeEmail(user.email),
    emailVerified: user.emailVerified,
    photoURL: user.picture,
  };
  return db.runTransaction(async (tx) => {
    const path = `users/${user.uid}`;
    const current = await tx.get(path);
    if (!current) {
      const profile: ProfileDto = { ...desired, createdAt: now, updatedAt: now, schemaVersion: SCHEMA_VERSION, version: 1 };
      tx.set(path, { ...profile }, { exists: false });
      return profile;
    }
    const existing = current.data as unknown as ProfileDto;
    const changed = (Object.keys(desired) as (keyof typeof desired)[]).some((k) => existing[k] !== desired[k]);
    if (!changed) return existing;
    const profile: ProfileDto = { ...existing, ...desired, updatedAt: now, version: existing.version + 1 };
    tx.set(path, { ...profile }, { updateTime: current.updateTime });
    return profile;
  });
}
