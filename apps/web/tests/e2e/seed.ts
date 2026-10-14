import { PROJECT } from './helpers';

const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `http://127.0.0.1:8080/v1/${ROOT}`;
const H = { authorization: 'Bearer owner', 'content-type': 'application/json' };

type V = Record<string, unknown>;
const enc = (v: unknown): V => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(enc) } : {} };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as V).map(([k, x]) => [k, enc(x)])) } };
};

export async function getDoc(path: string): Promise<V | null> {
  const r = await fetch(`${BASE}/${path}`, { headers: H });
  return r.ok ? ((await r.json()) as V) : null;
}

/** Writes `count` shared expenses for `uid` directly in the emulator, plus matching projections. */
export async function seedExpenses(tripId: string, uid: string, count: number): Promise<void> {
  const writes: V[] = [];
  const amount = 1000;
  for (let i = 0; i < count; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    writes.push({
      update: {
        name: `${ROOT}/trips/${tripId}/expenses/seed${String(i).padStart(4, '0')}`,
        fields: (enc({
          seq: i + 1, description: `Gasto ${i + 1}`, transactionDate: `2026-11-${day}`, categoryId: 'default-food',
          notes: null, servicePeriod: null, currency: 'USD', totalMinor: amount, payers: [{ uid, amountMinor: amount }],
          payerUids: [uid], splitMode: 'total', items: [], adjustments: [], beneficiaryUids: [uid], personalBeneficiaryUids: [],
          viewerUids: [uid], sharedTotalMinor: amount, personalTotalMinor: 0,
          chargesByMember: { [uid]: { sharedMinor: amount, personalMinor: 0, netMinor: amount } },
          ledgerEffect: { netByMember: {}, pairwise: {} }, status: 'active', createdBy: uid,
          createdAt: new Date(Date.now() - i * 1000), recordedAt: new Date(), schemaVersion: 2, version: 1,
        }) as { mapValue: { fields: V } }).mapValue.fields,
      },
    });
  }
  const total = count * amount;
  const proj = (path: string, data: V) => ({ update: { name: `${ROOT}/trips/${tripId}/${path}`, fields: (enc({ ...data, schemaVersion: 1, version: 1 }) as { mapValue: { fields: V } }).mapValue.fields } });
  writes.push(proj('projections/public', { sharedTotalMinor: total, expenseCount: count }));
  writes.push(proj('projections/categories', { byCategory: { 'default-food': total } }));
  writes.push(proj(`memberStats/${uid}`, {
    contributedMinor: total, sharedConsumedMinor: total, personalConsumedMinor: 0, globalConsumedMinor: total,
    visibleSharedByCategory: { 'default-food': total }, visibleExpenseCount: count,
  }));
  for (let i = 0; i < writes.length; i += 400) {
    const r = await fetch(`${BASE}:commit`, { method: 'POST', headers: H, body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
    if (!r.ok) throw new Error(`seed failed: ${r.status} ${await r.text()}`);
  }
}
