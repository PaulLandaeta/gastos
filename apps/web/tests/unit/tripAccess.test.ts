import { beforeEach, describe, expect, it } from 'vitest';
import { deleteLocalDb } from '../../src/features/offline/localDb';
import { CACHE_DAYS, TripAccess } from '../../src/features/offline/tripAccess';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await deleteLocalDb('ana');
});

describe('trip access index (clarification 1: 30 days)', () => {
  it('records when each trip was last opened and synced', async () => {
    const ta = new TripAccess('ana');
    await ta.touch('t1', 1_000);
    await ta.markSynced('t1', 2_000);
    expect(await ta.get('t1')).toEqual({ tripId: 't1', lastOpenedAt: 1_000, lastSyncedAt: 2_000 });
  });

  it('lists only trips opened in the last 30 days, most recent first', async () => {
    const ta = new TripAccess('ana');
    const now = 100 * DAY;
    await ta.touch('old', now - 31 * DAY);
    await ta.touch('recent', now - 2 * DAY);
    await ta.touch('today', now);
    expect((await ta.listRecent(now)).map((t) => t.tripId)).toEqual(['today', 'recent']);
    expect(CACHE_DAYS).toBe(30);
  });

  it('purges trips older than 30 days and reports them so their cached queries are removed', async () => {
    const ta = new TripAccess('ana');
    const now = 100 * DAY;
    await ta.touch('old', now - 31 * DAY);
    await ta.touch('recent', now - DAY);
    const removed: string[] = [];
    expect(await ta.purge(now, (id) => removed.push(id))).toEqual(['old']);
    expect(removed).toEqual(['old']);
    expect(await ta.get('old')).toBeUndefined();
    expect(await ta.get('recent')).toBeDefined();
  });
});
