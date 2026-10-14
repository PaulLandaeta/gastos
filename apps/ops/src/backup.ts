import { createHash } from 'node:crypto';
import type { Env } from '../../api/src/env.js';
import { COLLECTION_IDS } from './collections.js';
import { encrypt } from './crypto.js';
import { RawFirestore, type RawDoc } from './firestoreRaw.js';
import { backupKind, toDelete } from './retention.js';
import type { BackupStore } from './store.js';

export interface Manifest {
  format: 1;
  date: string;
  createdAt: string;
  kind: 'daily' | 'weekly';
  docCount: number;
  collections: Record<string, number>;
  sha256: string;
  bytes: number;
}

export const backupKey = (date: string) => `firestore/${date}/backup.gvb`;
export const manifestKey = (date: string) => `firestore/${date}/manifest.json`;

/** Every document of the database, as raw REST values (lossless). */
export async function exportAll(env: Env): Promise<{ docs: RawDoc[]; collections: Record<string, number> }> {
  const fs = new RawFirestore(env);
  const unknown = (await fs.listCollectionIds('')).filter((id) => !(COLLECTION_IDS as readonly string[]).includes(id));
  if (unknown.length) throw new Error(`Unknown top-level collections (add them to collections.ts): ${unknown.join(', ')}`);
  const docs: RawDoc[] = [];
  const collections: Record<string, number> = {};
  for (const id of COLLECTION_IDS) {
    let n = 0;
    for await (const d of fs.collectionGroup(id)) {
      docs.push(d);
      n++;
    }
    collections[id] = n;
  }
  return { docs, collections };
}

/** FR-017: daily encrypted copy in a store separate from the database and the receipts. */
export async function runBackup(env: Env, store: BackupStore, key: Buffer, now = new Date()): Promise<Manifest> {
  const { docs, collections } = await exportAll(env);
  const plain = Buffer.from(docs.map((d) => JSON.stringify(d)).join('\n'));
  const sealed = encrypt(plain, key);
  const date = now.toISOString().slice(0, 10);
  const manifest: Manifest = {
    format: 1,
    date,
    createdAt: now.toISOString(),
    kind: backupKind(now),
    docCount: docs.length,
    collections,
    sha256: createHash('sha256').update(plain).digest('hex'),
    bytes: sealed.length,
  };
  await store.put(backupKey(date), sealed, 'application/octet-stream');
  await store.put(manifestKey(date), Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
  return manifest;
}

export async function listBackupDates(store: BackupStore): Promise<string[]> {
  const keys = await store.list('firestore/');
  return [...new Set(keys.map((k) => /^firestore\/(\d{4}-\d{2}-\d{2})\/manifest\.json$/.exec(k)?.[1]).filter((d): d is string => !!d))].sort();
}

/** FR-018: removes the copies outside the 7 daily + 4 weekly window. */
export async function pruneBackups(store: BackupStore, now = new Date()): Promise<string[]> {
  const dates = toDelete(await listBackupDates(store), now);
  for (const date of dates) {
    // Manifest last: a half-deleted copy is never listed as complete.
    await store.delete(backupKey(date));
    await store.delete(manifestKey(date));
  }
  return dates;
}
