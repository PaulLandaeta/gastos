import { SCHEMA_VERSION } from 'contracts';
import type { Transaction } from '../firestore/client.js';

export interface ExpenseForProjection {
  categoryId: string;
  payers: { uid: string; amountMinor: number }[];
  chargesByMember: Record<string, { sharedMinor: number; personalMinor: number; netMinor: number }>;
  viewerUids: string[];
  sharedTotalMinor: number;
}

export interface PublicProjection {
  sharedTotalMinor: number;
  expenseCount: number;
}

export interface CategoriesProjection {
  byCategory: Record<string, number>;
}

export interface MemberStats {
  contributedMinor: number;
  sharedConsumedMinor: number;
  personalConsumedMinor: number;
  globalConsumedMinor: number;
  visibleSharedByCategory: Record<string, number>;
  visibleExpenseCount: number;
}

export interface Projections {
  public: PublicProjection;
  categories: CategoriesProjection;
  memberStats: Record<string, MemberStats>;
}

export const emptyStats = (): MemberStats => ({
  contributedMinor: 0,
  sharedConsumedMinor: 0,
  personalConsumedMinor: 0,
  globalConsumedMinor: 0,
  visibleSharedByCategory: {},
  visibleExpenseCount: 0,
});

function addToMap(map: Record<string, number>, key: string, delta: number): void {
  const next = (map[key] ?? 0) + delta;
  if (next === 0) delete map[key];
  else map[key] = next;
}

/** Adds (sign = 1) or subtracts (sign = -1) one expense to the projections, in place. */
export function applyExpense(p: Projections, e: ExpenseForProjection, sign: 1 | -1): void {
  p.public.sharedTotalMinor += sign * e.sharedTotalMinor;
  p.public.expenseCount += sign;
  if (e.sharedTotalMinor > 0) addToMap(p.categories.byCategory, e.categoryId, sign * e.sharedTotalMinor);

  const stats = (uid: string) => (p.memberStats[uid] ??= emptyStats());
  for (const payer of e.payers) stats(payer.uid).contributedMinor += sign * payer.amountMinor;
  for (const [uid, c] of Object.entries(e.chargesByMember)) {
    const s = stats(uid);
    s.sharedConsumedMinor += sign * c.sharedMinor;
    s.personalConsumedMinor += sign * c.personalMinor;
    s.globalConsumedMinor += sign * c.netMinor;
  }
  // Q3: each viewer's chart only aggregates the expenses that viewer can see.
  for (const uid of e.viewerUids) {
    const s = stats(uid);
    s.visibleExpenseCount += sign;
    if (e.sharedTotalMinor > 0) addToMap(s.visibleSharedByCategory, e.categoryId, sign * e.sharedTotalMinor);
  }
}

/** Constitution I: projections are rebuildable from the active expenses (tests compare both). */
export function rebuildProjections(activeExpenses: ExpenseForProjection[]): Projections {
  const p: Projections = { public: { sharedTotalMinor: 0, expenseCount: 0 }, categories: { byCategory: {} }, memberStats: {} };
  for (const e of activeExpenses) applyExpense(p, e, 1);
  return p;
}

const publicPath = (tripId: string) => `trips/${tripId}/projections/public`;
const categoriesPath = (tripId: string) => `trips/${tripId}/projections/categories`;
const statsPath = (tripId: string, uid: string) => `trips/${tripId}/memberStats/${uid}`;

interface Stored<T> {
  data: T;
  version: number;
  updateTime: string | null;
}

export interface LoadedProjections {
  public: Stored<PublicProjection>;
  categories: Stored<CategoriesProjection>;
  memberStats: Record<string, Stored<MemberStats>>;
}

function stored<T>(doc: { data: Record<string, unknown>; updateTime: string } | null | undefined, empty: T): Stored<T> {
  if (!doc) return { data: empty, version: 0, updateTime: null };
  const { schemaVersion: _s, version, ...data } = doc.data;
  return { data: { ...empty, ...(data as T) }, version: version as number, updateTime: doc.updateTime };
}

/** Reads the projection documents touched by an expense (public, categories, its viewers' stats). */
export async function readProjections(tx: Transaction, tripId: string, uids: string[]): Promise<LoadedProjections> {
  const paths = [publicPath(tripId), categoriesPath(tripId), ...uids.map((u) => statsPath(tripId, u))];
  const docs = await tx.getAll(paths);
  return {
    public: stored(docs.get(publicPath(tripId)), { sharedTotalMinor: 0, expenseCount: 0 }),
    categories: stored(docs.get(categoriesPath(tripId)), { byCategory: {} }),
    memberStats: Object.fromEntries(uids.map((u) => [u, stored(docs.get(statsPath(tripId, u)), emptyStats())])),
  };
}

/** Applies one expense (sign) and buffers the writes with optimistic preconditions. */
export function writeExpenseToProjections(
  tx: Transaction,
  tripId: string,
  loaded: LoadedProjections,
  expense: ExpenseForProjection,
  sign: 1 | -1,
): void {
  const p: Projections = {
    public: { ...loaded.public.data },
    categories: { byCategory: { ...loaded.categories.data.byCategory } },
    memberStats: Object.fromEntries(
      Object.entries(loaded.memberStats).map(([u, s]) => [
        u,
        { ...s.data, visibleSharedByCategory: { ...s.data.visibleSharedByCategory } },
      ]),
    ),
  };
  applyExpense(p, expense, sign);

  const put = <T extends object>(path: string, s: Stored<unknown>, data: T) =>
    tx.set(
      path,
      { ...data, schemaVersion: SCHEMA_VERSION, version: s.version + 1 },
      s.updateTime ? { updateTime: s.updateTime } : { exists: false },
    );
  put(publicPath(tripId), loaded.public, p.public);
  put(categoriesPath(tripId), loaded.categories, p.categories);
  for (const [uid, s] of Object.entries(p.memberStats)) {
    put(statsPath(tripId, uid), loaded.memberStats[uid] ?? { data: null, version: 0, updateTime: null }, s);
  }
}

/** Every uid whose stats an expense changes. */
export function affectedUids(e: ExpenseForProjection): string[] {
  return [...new Set([...e.viewerUids, ...e.payers.map((p) => p.uid), ...Object.keys(e.chargesByMember)])].sort();
}
