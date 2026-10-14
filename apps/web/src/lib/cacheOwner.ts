/**
 * Per-account local data (feature 005, FR-008): the offline caches belong to one account. When
 * another account signs in on the same device, or on sign-out, everything is wiped before any data
 * is shown, so nobody sees another account's cache or pending expenses.
 */
export const OWNER_KEY = 'cacheOwnerUid';

export interface LocalStores {
  clearFirestore: () => Promise<void>;
  clearQueryCache: () => Promise<void>;
  clearOutbox: (uid: string) => Promise<void>;
}

type OwnerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

async function wipe(uid: string, stores: LocalStores): Promise<void> {
  await stores.clearFirestore();
  await stores.clearQueryCache();
  await stores.clearOutbox(uid);
}

/** Returns `cleared` when another account's data had to be removed (the caller then reloads). */
export async function ensureCacheOwner(
  uid: string,
  stores: LocalStores,
  storage: OwnerStorage = localStorage,
): Promise<'same' | 'claimed' | 'cleared'> {
  const owner = storage.getItem(OWNER_KEY);
  if (owner === uid) return 'same';
  if (owner === null) {
    storage.setItem(OWNER_KEY, uid);
    return 'claimed';
  }
  await wipe(owner, stores);
  storage.setItem(OWNER_KEY, uid);
  return 'cleared';
}

export async function clearLocalData(uid: string, stores: LocalStores, storage: OwnerStorage = localStorage): Promise<void> {
  await wipe(uid, stores);
  storage.removeItem(OWNER_KEY);
}
