import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PendingExpense } from './outbox';
import type { TripAccessEntry } from './tripAccess';

/** Per-account IndexedDB (feature 005): pending expenses and the trip access index. */
interface LocalSchema extends DBSchema {
  pendingExpenses: { key: string; value: PendingExpense; indexes: { createdAt: number } };
  tripAccess: { key: string; value: TripAccessEntry };
}

export type LocalDb = IDBPDatabase<LocalSchema>;

export const localDbName = (uid: string) => `gastos-outbox-${uid}`;

const open = new Map<string, Promise<LocalDb>>();

export function openLocalDb(uid: string): Promise<LocalDb> {
  let db = open.get(uid);
  if (!db) {
    db = openDB<LocalSchema>(localDbName(uid), 1, {
      upgrade(d) {
        d.createObjectStore('pendingExpenses', { keyPath: 'localId' }).createIndex('createdAt', 'createdAt');
        d.createObjectStore('tripAccess', { keyPath: 'tripId' });
      },
      // Another tab is deleting the database (sign-out): let it.
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
        open.delete(uid);
      },
    });
    open.set(uid, db);
  }
  return db;
}

export async function deleteLocalDb(uid: string): Promise<void> {
  const db = open.get(uid);
  open.delete(uid);
  if (db) (await db).close();
  await deleteDB(localDbName(uid));
}
