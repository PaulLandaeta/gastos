import { EXPORT_PAGE_SIZE, type ExportExpense, type ExportFormat, type ExportRefund, type TripExportHeader, type TripExportPage } from 'contracts';
import { originalDebts, simplifiedDebts, type Member } from 'finance-engine';
import type { Doc, Firestore, Transaction } from '../firestore/client.js';
import { AppError } from '../http/errors.js';
import { writeAudit } from './audit.js';
import { readLedger } from './ledgerRepo.js';
import { emptyStats, type MemberStats } from './projections.js';
import { loadTripForMember, type LoadedTrip, type MutationContext } from './tripRepo.js';
import { canViewExpense } from './visibility.js';

/**
 * Trip export (feature 005, RF-19). The API only assembles privacy-filtered data, in pages of
 * ≤ 100 expenses so each request stays inside the Workers Free CPU budget; the browser builds the
 * Excel/PDF file. Nothing is stored. A participant gets exactly what the app shows them (RF-38,
 * RF-39, FR-026); creator and admins get every expense.
 */
interface Cursor {
  t: string;
  u: string;
  s: number;
}

const encodeCursor = (c: Cursor) => btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeCursor(raw: string, tripId: string, uid: string): number {
  try {
    const c = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))) as Cursor;
    if (c.t === tripId && c.u === uid && Number.isSafeInteger(c.s) && c.s >= 0) return c.s;
  } catch {
    // fall through
  }
  throw new AppError('VALIDATION_FAILED', 'Invalid request', { fields: { cursor: 'Invalid cursor' } });
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
const isManager = (loaded: LoadedTrip) => loaded.me.data.role === 'creator' || loaded.me.data.role === 'admin';

export function toExportExpense(doc: Doc): ExportExpense {
  const d = doc.data as Record<string, unknown>;
  const charges = (d['chargesByMember'] ?? {}) as Record<string, { netMinor: number }>;
  const items = (d['items'] ?? []) as {
    description?: string;
    quantity?: number;
    grossMinor: number;
    discountMinor?: number;
    classification: 'shared' | 'personal';
    beneficiaries: string[];
  }[];
  return {
    id: doc.id,
    seq: d['seq'] as number,
    transactionDate: d['transactionDate'] as string,
    createdAt: iso(d['createdAt']) ?? '',
    description: d['description'] as string,
    categoryId: d['categoryId'] as string,
    totalMinor: d['totalMinor'] as number,
    sharedMinor: (d['sharedTotalMinor'] as number | undefined) ?? 0,
    personalMinor: (d['personalTotalMinor'] as number | undefined) ?? 0,
    status: d['status'] as 'active' | 'voided',
    source: (d['source'] as 'manual' | 'ai' | undefined) ?? 'manual',
    payers: (d['payers'] ?? []) as { uid: string; amountMinor: number }[],
    allocations: Object.entries(charges).map(([uid, c]) => ({ uid, amountMinor: c.netMinor })),
    items: items.map((i) => ({
      description: i.description ?? null,
      quantity: i.quantity ?? 1,
      grossMinor: i.grossMinor,
      discountMinor: i.discountMinor ?? 0,
      classification: i.classification,
      beneficiaries: i.beneficiaries,
    })),
    adjustments: ((d['adjustments'] ?? []) as { kind: string; amountMinor: number }[]).map((a) => ({ kind: a.kind, amountMinor: a.amountMinor })),
  };
}

async function buildHeader(tx: Transaction, loaded: LoadedTrip, uid: string, now: Date): Promise<TripExportHeader> {
  const tripId = loaded.trip.id;
  const manager = isManager(loaded);
  const accepted = loaded.members.filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid);
  const uids = accepted.map((m) => m.data.uid!);
  const [docs, ledger, categories, settlements] = await Promise.all([
    tx.getAll([`trips/${tripId}/projections/public`, `trips/${tripId}/projections/categories`, ...uids.map((u) => `trips/${tripId}/memberStats/${u}`)]),
    readLedger(tx, tripId),
    tx.query(`trips/${tripId}/categories`),
    tx.query(`trips/${tripId}/settlements`),
  ]);
  const statsOf = (u: string): MemberStats => ({
    ...emptyStats(),
    ...((docs.get(`trips/${tripId}/memberStats/${u}`)?.data ?? {}) as Partial<MemberStats>),
  });
  const engineMembers: Member[] = accepted.map((m) => ({ uid: m.data.uid!, joinOrder: m.data.joinOrder ?? 0 }));
  const categoryName = new Map(categories.map((c) => [c.id, c.data['name'] as string]));
  const pub = docs.get(`trips/${tripId}/projections/public`)?.data ?? {};
  const byCategory = manager
    ? (((docs.get(`trips/${tripId}/projections/categories`)?.data ?? {})['byCategory'] ?? {}) as Record<string, number>)
    : statsOf(uid).visibleSharedByCategory;
  const me = accepted.find((m) => m.data.uid === uid)!;

  return {
    trip: {
      id: tripId,
      name: loaded.trip.data.name,
      currency: loaded.trip.data.currency,
      status: loaded.trip.data.status,
      startDate: loaded.trip.data.startDate,
      endDate: loaded.trip.data.endDate,
    },
    generatedAt: now.toISOString(),
    generatedBy: { uid, displayName: me.data.displayName ?? me.data.email },
    scope: manager ? 'all' : 'visible',
    registeredCount: loaded.trip.data.expenseSeq,
    members: accepted.map((m) => ({ uid: m.data.uid!, displayName: m.data.displayName ?? m.data.email })),
    categories: categories.map((c) => ({ id: c.id, name: c.data['name'] as string })),
    // Payments are visible to every member (Rules, RF-39).
    settlements: settlements.map((s) => ({
      id: s.id,
      fromUid: s.data['fromUid'] as string,
      toUid: s.data['toUid'] as string,
      amountMinor: s.data['amountMinor'] as number,
      status: s.data['status'] as string,
      createdAt: iso(s.data['createdAt']),
      resolvedAt: iso(s.data['resolvedAt']),
    })),
    balances: uids.map((u) => {
      const own = manager || u === uid;
      const s = statsOf(u);
      return {
        uid: u,
        paidMinor: own ? s.contributedMinor : null,
        consumedMinor: own ? s.globalConsumedMinor : null,
        netMinor: ledger.effect.netByMember[u] ?? 0,
      };
    }),
    debts: { original: originalDebts(ledger.effect, engineMembers), simplified: simplifiedDebts(ledger.effect, engineMembers) },
    totals: {
      sharedMinor: (pub['sharedTotalMinor'] as number | undefined) ?? 0,
      personalMinor: (manager ? uids : [uid]).reduce((a, u) => a + statsOf(u).personalConsumedMinor, 0),
      byCategory: Object.entries(byCategory)
        .filter(([, total]) => total !== 0)
        .map(([categoryId, totalMinor]) => ({ categoryId, name: categoryName.get(categoryId) ?? categoryId, totalMinor })),
    },
  };
}

export async function exportPage(
  db: Firestore,
  tripId: string,
  format: ExportFormat,
  rawCursor: string | undefined,
  ctx: MutationContext,
): Promise<TripExportPage> {
  const uid = ctx.actorUid;
  const afterSeq = rawCursor === undefined ? 0 : decodeCursor(rawCursor, tripId, uid);
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, uid);
    const manager = isManager(loaded);
    const where: [string, '>' | 'array-contains', unknown][] = [['seq', '>', afterSeq]];
    // Participants: the same constraint the Security Rules enforce (RF-38).
    if (!manager) where.unshift(['viewerUids', 'array-contains', uid]);
    const [docs, refundDocs] = await Promise.all([
      tx.query(`trips/${tripId}/expenses`, { where, orderBy: [['seq', 'asc']], limit: EXPORT_PAGE_SIZE }),
      tx.query(`trips/${tripId}/refunds`, { allDescendants: true }),
    ]);
    const visible = docs.filter((d) => manager || canViewExpense(loaded.me.data, d.data as never));
    const expenses = visible.map(toExportExpense);
    const ids = new Set(expenses.map((e) => e.id));
    const refunds: ExportRefund[] = refundDocs
      .map((r) => ({ r, expenseId: r.path.split('/')[3]! }))
      .filter(({ expenseId }) => ids.has(expenseId))
      .map(({ r, expenseId }) => ({
        id: r.id,
        expenseId,
        itemId: r.data['itemId'] as string,
        quantity: (r.data['quantity'] as number | undefined) ?? 0,
        amountMinor: r.data['amountMinor'] as number,
        recipientUid: r.data['recipientUid'] as string,
        createdAt: iso(r.data['createdAt']),
      }));

    let header: TripExportHeader | undefined;
    if (rawCursor === undefined) {
      header = await buildHeader(tx, loaded, uid, ctx.now);
      writeAudit(
        tx,
        {
          tripId,
          actorUid: uid,
          action: 'trip.exported',
          entityType: 'trip',
          entityId: tripId,
          beforeVersion: loaded.trip.data.version,
          afterVersion: loaded.trip.data.version,
          correlationId: ctx.correlationId,
          diff: { format, scope: header.scope },
        },
        ctx.now,
      );
    }
    const last = docs.at(-1)?.data['seq'] as number | undefined;
    return {
      ...(header ? { header } : {}),
      expenses: expenses.filter((e) => e.status === 'active'),
      voidedExpenses: expenses.filter((e) => e.status === 'voided'),
      refunds,
      nextCursor: docs.length === EXPORT_PAGE_SIZE && last !== undefined ? encodeCursor({ t: tripId, u: uid, s: last }) : null,
    };
  });
}
