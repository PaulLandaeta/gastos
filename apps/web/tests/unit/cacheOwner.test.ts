import { describe, expect, it, vi } from 'vitest';
import { clearLocalData, ensureCacheOwner, OWNER_KEY, type LocalStores } from '../../src/lib/cacheOwner';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function stores(): LocalStores & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clearFirestore: vi.fn(async () => void calls.push('firestore')),
    clearQueryCache: vi.fn(async () => void calls.push('queries')),
    clearOutbox: vi.fn(async (uid: string) => void calls.push(`outbox:${uid}`)),
  };
}

describe('per-account local data (FR-008)', () => {
  it('claims an empty device without clearing anything', async () => {
    const s = stores();
    const storage = memoryStorage();
    expect(await ensureCacheOwner('ana', s, storage)).toBe('claimed');
    expect(storage.getItem(OWNER_KEY)).toBe('ana');
    expect(s.calls).toEqual([]);
  });

  it('keeps the cache for the same account', async () => {
    const s = stores();
    const storage = memoryStorage();
    storage.setItem(OWNER_KEY, 'ana');
    expect(await ensureCacheOwner('ana', s, storage)).toBe('same');
    expect(s.calls).toEqual([]);
  });

  it('clears the previous account data (cache and its pending queue) before another account uses it', async () => {
    const s = stores();
    const storage = memoryStorage();
    storage.setItem(OWNER_KEY, 'ana');
    expect(await ensureCacheOwner('juan', s, storage)).toBe('cleared');
    expect(s.calls).toEqual(['firestore', 'queries', 'outbox:ana']);
    expect(storage.getItem(OWNER_KEY)).toBe('juan');
  });

  it('sign-out clears everything for the account and forgets the owner', async () => {
    const s = stores();
    const storage = memoryStorage();
    storage.setItem(OWNER_KEY, 'ana');
    await clearLocalData('ana', s, storage);
    expect(s.calls).toEqual(['firestore', 'queries', 'outbox:ana']);
    expect(storage.getItem(OWNER_KEY)).toBeNull();
  });
});
