import { openLocalDb } from './localDb';

/** Trips kept for offline use: those opened in the last 30 days (clarification 1, FR-008). */
export const CACHE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TripAccessEntry {
  tripId: string;
  lastOpenedAt: number;
  lastSyncedAt: number | null;
}

export class TripAccess {
  constructor(readonly uid: string) {}

  private db() {
    return openLocalDb(this.uid);
  }

  async get(tripId: string): Promise<TripAccessEntry | undefined> {
    return (await this.db()).get('tripAccess', tripId);
  }

  async touch(tripId: string, at = Date.now()): Promise<void> {
    const db = await this.db();
    const current = await db.get('tripAccess', tripId);
    await db.put('tripAccess', { tripId, lastOpenedAt: at, lastSyncedAt: current?.lastSyncedAt ?? null });
  }

  /** Last time server data for the trip arrived (shown as «datos del …» offline). */
  async markSynced(tripId: string, at = Date.now()): Promise<void> {
    const db = await this.db();
    const current = await db.get('tripAccess', tripId);
    await db.put('tripAccess', { tripId, lastOpenedAt: current?.lastOpenedAt ?? at, lastSyncedAt: at });
  }

  async listRecent(now = Date.now()): Promise<TripAccessEntry[]> {
    const all = await (await this.db()).getAll('tripAccess');
    return all.filter((t) => now - t.lastOpenedAt <= CACHE_DAYS * DAY_MS).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  /** Forgets trips not opened in 30 days; `onPurged` removes their cached queries. */
  async purge(now = Date.now(), onPurged?: (tripId: string) => void): Promise<string[]> {
    const db = await this.db();
    const stale = (await db.getAll('tripAccess')).filter((t) => now - t.lastOpenedAt > CACHE_DAYS * DAY_MS);
    for (const t of stale) {
      await db.delete('tripAccess', t.tripId);
      onPurged?.(t.tripId);
    }
    return stale.map((t) => t.tripId);
  }
}
