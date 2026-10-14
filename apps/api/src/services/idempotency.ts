import type { Transaction } from '../firestore/client.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const idempotencyPath = (tripId: string, uid: string, key: string) => `idempotencyKeys/${tripId}_${uid}_${key}`;

export interface IdempotencyRecord {
  operation: string;
  resultRef: string;
}

/** Returns the stored result reference when this key was already used by the same user. */
export async function findIdempotent(tx: Transaction, path: string): Promise<IdempotencyRecord | null> {
  const doc = await tx.get(path);
  return doc ? (doc.data as unknown as IdempotencyRecord) : null;
}

/** Registers the key in the same transaction; `exists: false` guarantees a single effect. */
export function recordIdempotent(tx: Transaction, path: string, record: IdempotencyRecord, now: Date): void {
  tx.set(
    path,
    { ...record, createdAt: now, expiresAt: new Date(now.getTime() + TTL_MS), schemaVersion: 1 },
    { exists: false },
  );
}
