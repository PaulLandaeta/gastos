import type { MemberCharge } from 'finance-engine';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/useFirestore';

export interface Category {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  active: boolean;
  version: number;
}

export interface ExpenseView {
  id: string;
  seq: number;
  description: string;
  transactionDate: string;
  categoryId: string;
  notes: string | null;
  servicePeriod: { startDate: string; endDate: string } | null;
  totalMinor: number;
  payers: { uid: string; amountMinor: number }[];
  payerUids: string[];
  beneficiaryUids: string[];
  personalBeneficiaryUids: string[];
  viewerUids: string[];
  sharedTotalMinor: number;
  personalTotalMinor: number;
  chargesByMember: Record<string, MemberCharge>;
  splitMode: 'total' | 'items';
  items: {
    id: string;
    index: number;
    description?: string;
    grossMinor: number;
    discountMinor: number;
    classification: 'shared' | 'personal';
    beneficiaries: string[];
    allocation: { mode: string };
  }[];
  adjustments: { kind: 'discount' | 'tax' | 'tip'; amountMinor: number; mode: string }[];
  status: 'active' | 'voided';
  createdBy: string;
  createdAt: Date;
  version: number;
}

export function useCategories(tripId: string) {
  const { data, loading } = useCollection<Omit<Category, 'id'>>(`trips/${tripId}/categories`);
  const all = useMemo(
    () => [...(data ?? [])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    [data],
  );
  return { all, active: all.filter((c) => c.active), loading };
}

export interface ExpenseQuery {
  tripId: string;
  uid: string;
  /** Live role: creators/admins may list every expense; members only their own (Rules). */
  isManager: boolean;
  pageSize?: number;
  from?: string;
  to?: string;
  categoryId?: string;
}

/**
 * Live, paginated list of the expenses the user may see (RF-38). Members always constrain the
 * query with `viewerUids array-contains uid`, which is what the Security Rules require.
 */
export function useExpenses(q: ExpenseQuery) {
  const { tripId, uid, isManager, from, to, categoryId } = q;
  const [pageCount, setPageCount] = useState(1);
  const pageSize = q.pageSize ?? 50;
  const [state, setState] = useState<{ data: ExpenseView[]; loading: boolean; error: Error | null; hasMore: boolean }>({
    data: [],
    loading: true,
    error: null,
    hasMore: false,
  });

  useEffect(() => setPageCount(1), [tripId, uid, isManager, from, to, categoryId]);

  useEffect(() => {
    const constraints: QueryConstraint[] = [];
    if (!isManager) constraints.push(where('viewerUids', 'array-contains', uid));
    if (categoryId) constraints.push(where('categoryId', '==', categoryId));
    if (from) constraints.push(where('transactionDate', '>=', from));
    if (to) constraints.push(where('transactionDate', '<=', to));
    constraints.push(orderBy('transactionDate', 'desc'));
    if (!categoryId) constraints.push(orderBy('createdAt', 'desc'));
    const max = pageSize * pageCount;
    constraints.push(limit(max + 1));
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      query(collection(db, `trips/${tripId}/expenses`), ...constraints),
      (snap) => {
        const docs = snap.docs.map((d) => {
          const data = d.data();
          return { ...data, id: d.id, createdAt: data['createdAt']?.toDate?.() ?? new Date(0) } as ExpenseView;
        });
        setState({ data: docs.slice(0, max), loading: false, error: null, hasMore: docs.length > max });
      },
      (error) => setState({ data: [], loading: false, error, hasMore: false }),
    );
  }, [tripId, uid, isManager, from, to, categoryId, pageSize, pageCount]);

  return { ...state, loadMore: () => setPageCount((n) => n + 1) };
}
