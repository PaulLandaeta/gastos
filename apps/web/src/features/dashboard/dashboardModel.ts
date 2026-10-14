import type { ExpenseView } from '../expenses/useExpenses';

export interface DashboardFilters {
  from?: string | undefined;
  to?: string | undefined;
  categoryId?: string | undefined;
  /** Beneficiary. */
  personUid?: string | undefined;
  payerUid?: string | undefined;
}

export interface Aggregate {
  sharedTotalMinor: number;
  contributedMinor: number;
  sharedConsumedMinor: number;
  personalConsumedMinor: number;
  globalConsumedMinor: number;
  byCategory: Record<string, number>;
  count: number;
}

export const hasFilters = (f: DashboardFilters) => Object.values(f).some((v) => v !== undefined && v !== '');

/** FR-025: filters only operate on the expenses the user can see (the input list). */
export function applyFilters(expenses: ExpenseView[], f: DashboardFilters): ExpenseView[] {
  return expenses.filter(
    (e) =>
      e.status === 'active' &&
      (!f.from || e.transactionDate >= f.from) &&
      (!f.to || e.transactionDate <= f.to) &&
      (!f.categoryId || e.categoryId === f.categoryId) &&
      (!f.personUid || e.beneficiaryUids.includes(f.personUid)) &&
      (!f.payerUid || e.payerUids.includes(f.payerUid)),
  );
}

/** Totals over visible, active expenses; global = shared + personal (RF-40). */
export function aggregate(expenses: ExpenseView[], uid: string): Aggregate {
  const a: Aggregate = {
    sharedTotalMinor: 0,
    contributedMinor: 0,
    sharedConsumedMinor: 0,
    personalConsumedMinor: 0,
    globalConsumedMinor: 0,
    byCategory: {},
    count: 0,
  };
  for (const e of expenses) {
    if (e.status !== 'active') continue;
    a.count += 1;
    a.sharedTotalMinor += e.sharedTotalMinor;
    if (e.sharedTotalMinor > 0) a.byCategory[e.categoryId] = (a.byCategory[e.categoryId] ?? 0) + e.sharedTotalMinor;
    a.contributedMinor += e.payers.filter((p) => p.uid === uid).reduce((s, p) => s + p.amountMinor, 0);
    const mine = e.chargesByMember[uid];
    if (mine) {
      a.sharedConsumedMinor += mine.sharedMinor;
      a.personalConsumedMinor += mine.personalMinor;
      a.globalConsumedMinor += mine.netMinor;
    }
  }
  return a;
}
