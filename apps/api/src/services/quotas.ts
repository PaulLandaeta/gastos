import { DEFAULT_AI_QUOTAS, type QuotaScope } from 'contracts';
import type { Env } from '../env.js';
import type { Doc, Firestore, Transaction } from '../firestore/client.js';
import { AppError } from '../http/errors.js';

export interface AiLimits {
  tripDay: number;
  globalDay: number;
  globalMonth: number;
  retriesPerFile: number;
}

const positive = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;
};

/**
 * FR-016: limits come from the `config/ai` document (set by the technical admin, no redeploy),
 * then env vars, then the documented defaults.
 */
export async function loadLimits(db: Firestore, env: Env): Promise<AiLimits> {
  const cfg = (await db.get('config/ai'))?.data ?? {};
  return {
    tripDay: positive(cfg['tripDay']) ?? positive(env.AI_QUOTA_TRIP_DAY) ?? DEFAULT_AI_QUOTAS.tripDay,
    globalDay: positive(cfg['globalDay']) ?? positive(env.AI_QUOTA_GLOBAL_DAY) ?? DEFAULT_AI_QUOTAS.globalDay,
    globalMonth: positive(cfg['globalMonth']) ?? positive(env.AI_QUOTA_GLOBAL_MONTH) ?? DEFAULT_AI_QUOTAS.globalMonth,
    retriesPerFile: positive(cfg['retriesPerFile']) ?? DEFAULT_AI_QUOTAS.retriesPerFile,
  };
}

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export const usagePaths = (tripId: string, now: Date) => ({
  trip: `trips/${tripId}/aiUsage/${dayOf(now)}`,
  globalDay: `aiUsage/global_${dayOf(now)}`,
  globalMonth: `aiUsage/global_${monthOf(now)}`,
});

interface UsageDoc {
  scope: 'trip' | 'global_day' | 'global_month';
  date: string;
  tripId: string | null;
  requests: number;
  pages: number;
  bytes: number;
  failures: number;
  succeeded: number;
  latencyMsTotal: number;
  byProvider: Record<string, number>;
  byUser: Record<string, number>;
  version: number;
}

const emptyUsage = (scope: UsageDoc['scope'], date: string, tripId: string | null): UsageDoc => ({
  scope,
  date,
  tripId,
  requests: 0,
  pages: 0,
  bytes: 0,
  failures: 0,
  succeeded: 0,
  latencyMsTotal: 0,
  byProvider: {},
  byUser: {},
  version: 0,
});

const nextUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const nextUtcMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export interface Reservation {
  tripId: string;
  uid: string;
  provider: string;
  pages: number;
  bytes: number;
  /** When the reservation was made (counters are per that day/month). */
  at: Date;
}

async function readUsage(tx: Transaction, tripId: string, at: Date) {
  const paths = usagePaths(tripId, at);
  const docs = await tx.getAll([paths.trip, paths.globalDay, paths.globalMonth]);
  const of = (p: string, scope: UsageDoc['scope'], date: string, t: string | null) =>
    ((docs.get(p) as Doc | null)?.data as unknown as UsageDoc | undefined) ?? emptyUsage(scope, date, t);
  return {
    paths,
    trip: of(paths.trip, 'trip', dayOf(at), tripId),
    globalDay: of(paths.globalDay, 'global_day', dayOf(at), null),
    globalMonth: of(paths.globalMonth, 'global_month', monthOf(at), null),
  };
}

const exceeded = (scope: QuotaScope, resetsAt: Date | null) =>
  new AppError('AI_QUOTA_EXCEEDED', 'AI scan quota exhausted; manual registration is still available', {
    scope,
    resetsAt: resetsAt ? resetsAt.toISOString() : null,
  });

/**
 * RF-51: reserves one analysis in the trip, global-day and global-month counters inside the
 * caller's transaction, so concurrent scans at the limit cannot all pass (the transaction retries
 * and re-reads). Returns how many trip scans remain today after this one.
 */
export async function reserveQuota(tx: Transaction, r: Reservation, limits: AiLimits): Promise<number> {
  const u = await readUsage(tx, r.tripId, r.at);
  if (u.trip.requests >= limits.tripDay) throw exceeded('trip', nextUtcDay(r.at));
  if (u.globalDay.requests >= limits.globalDay) throw exceeded('global_day', nextUtcDay(r.at));
  if (u.globalMonth.requests >= limits.globalMonth) throw exceeded('global_month', nextUtcMonth(r.at));
  const bump = (d: UsageDoc, withUser: boolean): UsageDoc => ({
    ...d,
    requests: d.requests + 1,
    pages: d.pages + r.pages,
    bytes: d.bytes + r.bytes,
    byProvider: { ...d.byProvider, [r.provider]: (d.byProvider[r.provider] ?? 0) + 1 },
    byUser: withUser ? { ...d.byUser, [r.uid]: (d.byUser[r.uid] ?? 0) + 1 } : d.byUser,
    version: d.version + 1,
  });
  tx.set(u.paths.trip, { ...bump(u.trip, true) });
  tx.set(u.paths.globalDay, { ...bump(u.globalDay, false) });
  tx.set(u.paths.globalMonth, { ...bump(u.globalMonth, false) });
  return limits.tripDay - u.trip.requests - 1;
}

/** Provider failure: gives the reservation back (FR-017: no cost) and counts the failure. */
export async function releaseQuota(tx: Transaction, r: Reservation): Promise<void> {
  const u = await readUsage(tx, r.tripId, r.at);
  const back = (d: UsageDoc, withUser: boolean): UsageDoc => ({
    ...d,
    requests: Math.max(0, d.requests - 1),
    pages: Math.max(0, d.pages - r.pages),
    bytes: Math.max(0, d.bytes - r.bytes),
    failures: d.failures + 1,
    byProvider: { ...d.byProvider, [r.provider]: Math.max(0, (d.byProvider[r.provider] ?? 1) - 1) },
    byUser: withUser ? { ...d.byUser, [r.uid]: Math.max(0, (d.byUser[r.uid] ?? 1) - 1) } : d.byUser,
    version: d.version + 1,
  });
  tx.set(u.paths.trip, { ...back(u.trip, true) });
  tx.set(u.paths.globalDay, { ...back(u.globalDay, false) });
  tx.set(u.paths.globalMonth, { ...back(u.globalMonth, false) });
}

/** Success metrics (FR-019): count and latency; never any receipt content. */
export async function commitUsage(tx: Transaction, r: Reservation, latencyMs: number): Promise<void> {
  const u = await readUsage(tx, r.tripId, r.at);
  for (const [path, d] of [
    [u.paths.trip, u.trip],
    [u.paths.globalDay, u.globalDay],
    [u.paths.globalMonth, u.globalMonth],
  ] as const) {
    tx.set(path, { ...d, succeeded: d.succeeded + 1, latencyMsTotal: d.latencyMsTotal + latencyMs, version: d.version + 1 });
  }
}

/** GET /admin/ai-usage aggregation over global day documents and per-trip day documents. */
export async function aiUsageReport(db: Firestore, from: string, to: string) {
  const dates: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); dayOf(d) <= to && dates.length < 92; d = new Date(d.getTime() + 86_400_000)) {
    dates.push(dayOf(d));
  }
  const globals = await db.batchGet(dates.map((d) => `aiUsage/global_${d}`));
  const days = dates.map((date) => {
    const u = (globals.get(`aiUsage/global_${date}`)?.data as unknown as UsageDoc | undefined) ?? emptyUsage('global_day', date, null);
    return { date, requests: u.requests, pages: u.pages, bytes: u.bytes, failures: u.failures, byProvider: u.byProvider };
  });
  const tripDocs = await db.query('aiUsage', {
    allDescendants: true,
    where: [
      ['date', '>=', from],
      ['date', '<=', to],
    ],
  });
  const trips = new Map<string, { tripId: string; requests: number; pages: number; bytes: number; failures: number }>();
  const users = new Map<string, number>();
  for (const doc of tripDocs) {
    const u = doc.data as unknown as UsageDoc;
    if (u.scope !== 'trip' || !u.tripId) continue;
    const t = trips.get(u.tripId) ?? { tripId: u.tripId, requests: 0, pages: 0, bytes: 0, failures: 0 };
    t.requests += u.requests;
    t.pages += u.pages;
    t.bytes += u.bytes;
    t.failures += u.failures;
    trips.set(u.tripId, t);
    for (const [uid, n] of Object.entries(u.byUser ?? {})) users.set(uid, (users.get(uid) ?? 0) + n);
  }
  return {
    days,
    trips: [...trips.values()].sort((a, b) => b.requests - a.requests),
    users: [...users.entries()].map(([uid, requests]) => ({ uid, requests })).sort((a, b) => b.requests - a.requests),
  };
}

/** T031: remaining scans for a trip today (the tightest of trip, global day and global month). */
export async function quotaStatus(db: Firestore, tripId: string, limits: AiLimits, now: Date) {
  const paths = usagePaths(tripId, now);
  const docs = await db.batchGet([paths.trip, paths.globalDay, paths.globalMonth]);
  const used = (p: string) => ((docs.get(p)?.data['requests'] as number | undefined) ?? 0);
  const left: [QuotaScope, number, Date][] = [
    ['trip', limits.tripDay - used(paths.trip), nextUtcDay(now)],
    ['global_day', limits.globalDay - used(paths.globalDay), nextUtcDay(now)],
    ['global_month', limits.globalMonth - used(paths.globalMonth), nextUtcMonth(now)],
  ];
  const tightest = left.reduce((a, b) => (b[1] < a[1] ? b : a));
  const remaining = Math.max(0, tightest[1]);
  return {
    tripRemainingToday: remaining,
    tripLimit: limits.tripDay,
    exhaustedScope: remaining === 0 ? tightest[0] : null,
    resetsAt: remaining === 0 ? tightest[2].toISOString() : null,
  };
}
