import { createHash } from 'node:crypto';
import type { ReceiptStorageProvider } from 'contracts';
import { lookupAuthUsers } from '../../api/src/auth/identityToolkit.js';
import type { Env } from '../../api/src/env.js';
import { Firestore } from '../../api/src/firestore/client.js';
import { createStorageProvider } from '../../api/src/providers/storage.js';
import { reconcileDeletions } from '../../api/src/services/accountDeletion.js';
import { backupKey, listBackupDates, manifestKey, type Manifest } from './backup.js';
import { decrypt } from './crypto.js';
import { RawFirestore, type RawDoc } from './firestoreRaw.js';
import type { BackupStore } from './store.js';

/** Receipt objects of restored data were already deleted at deletion time: deleting is a no-op. */
const noopStorage: ReceiptStorageProvider = {
  name: 'noop',
  presignPut: () => Promise.reject(new Error('not available during restore')),
  presignGet: () => Promise.reject(new Error('not available during restore')),
  head: async () => null,
  get: async () => null,
  delete: async () => undefined,
};

export const receiptStorage = (env: Env): ReceiptStorageProvider => (env.STORAGE === 'b2' ? createStorageProvider(env) : noopStorage);

export async function readBackup(store: BackupStore, key: Buffer, date?: string): Promise<{ manifest: Manifest; docs: RawDoc[] }> {
  const chosen = date ?? (await listBackupDates(store)).at(-1);
  if (!chosen) throw new Error('No backups found');
  const [manifestRaw, sealed] = await Promise.all([store.get(manifestKey(chosen)), store.get(backupKey(chosen))]);
  if (!manifestRaw || !sealed) throw new Error(`Backup ${chosen} is incomplete`);
  const manifest = JSON.parse(manifestRaw.toString()) as Manifest;
  const plain = decrypt(sealed, key);
  if (createHash('sha256').update(plain).digest('hex') !== manifest.sha256) throw new Error(`Backup ${chosen} failed the integrity check`);
  const docs = plain.length ? plain.toString().split('\n').map((l) => JSON.parse(l) as RawDoc) : [];
  if (docs.length !== manifest.docCount) throw new Error(`Backup ${chosen}: expected ${manifest.docCount} documents, found ${docs.length}`);
  return { manifest, docs };
}

export interface RestoreOptions {
  date?: string;
  /** Must equal the target project id (guard against restoring into the wrong project). */
  confirmProject: string;
  /** Uids deleted after the copy, exported from the live registry before wiping (optional). */
  deletedUids?: string[];
  /** Restore over existing data (default: the target must be empty). */
  allowNonEmpty?: boolean;
}

/** FR-019/FR-020: writes the copy and re-applies every account deletion it does not reflect. */
export async function runRestore(env: Env, store: BackupStore, key: Buffer, opts: RestoreOptions) {
  if (opts.confirmProject !== env.FIREBASE_PROJECT_ID) {
    throw new Error(`Refusing to restore: target project is ${env.FIREBASE_PROJECT_ID}, confirmation says ${opts.confirmProject}`);
  }
  const raw = new RawFirestore(env);
  if (!opts.allowNonEmpty && (await raw.listCollectionIds('')).length > 0) {
    throw new Error('The target database is not empty (empty it first or pass --allow-non-empty)');
  }
  const { manifest, docs } = await readBackup(store, key, opts.date);
  await raw.writeAll(docs);
  const reapplied = await reconcileDeletions(new Firestore(env), receiptStorage(env), env, {
    extraUids: opts.deletedUids ?? [],
    lookupAuth: (uids) => lookupAuthUsers(env, uids),
  });
  return { date: manifest.date, documents: docs.length, reappliedDeletions: reapplied.length };
}

/** Uids in the live deletion registry (export before wiping a database to restore it). */
export async function exportDeletedUids(env: Env): Promise<string[]> {
  return (await new Firestore(env).query('accountDeletions')).map((d) => d.id);
}
