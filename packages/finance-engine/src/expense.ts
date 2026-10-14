import { allocateLargestRemainder } from './allocate.js';
import { EngineError, assertNonNegativeMinor, assertSafeMinor, toSafeNumber } from './money.js';
import { memberRanking } from './order.js';
import type {
  ExpenseInput,
  ExpenseItem,
  ExpenseResult,
  GeneralAdjustment,
  LedgerEffect,
  MemberCharge,
  Payer,
  Uid,
} from './types.js';

const ADJUSTMENT_ORDER: Record<GeneralAdjustment['kind'], number> = { discount: 0, tax: 1, tip: 2 };
const FULL_PERCENT_BP = 10_000;

/**
 * Computes the charges of every beneficiary and the ledger effect of one expense.
 * Pure and deterministic: the same input always yields the same output regardless of the
 * order of members, payers, items, beneficiaries or shares (spec FR-001…FR-007, FR-011).
 */
export function computeExpense(input: ExpenseInput): ExpenseResult {
  const { seq, totalMinor } = input;
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new EngineError('INVALID_ALLOCATION', 'seq must be an integer >= 1');
  }
  assertSafeMinor(totalMinor, 'totalMinor');
  if (totalMinor <= 0) throw new EngineError('INVALID_ALLOCATION', 'totalMinor must be positive');

  const rank = memberRanking(input.members);
  const byRank = (a: Uid, b: Uid) => rank.get(a)! - rank.get(b)!;

  const payers = validatePayers(input.payers, rank, totalMinor).sort((a, b) => byRank(a.uid, b.uid));
  const items = validateItems(input, rank);

  // 1. Item-level allocation (shared vs personal buckets).
  const shared = new Map<Uid, number>();
  const personal = new Map<Uid, number>();
  let itemsNet = 0;
  for (const item of items) {
    const net = item.grossMinor - item.discountMinor;
    itemsNet += net;
    const beneficiaries = [...item.beneficiaries].sort(byRank);
    const amounts = allocateItem(item, beneficiaries, net, seq - 1 + item.index);
    const bucket = item.classification === 'personal' ? personal : shared;
    beneficiaries.forEach((uid, i) => {
      bucket.set(uid, (bucket.get(uid) ?? 0) + amounts[i]!);
      const other = bucket === shared ? personal : shared;
      if (!other.has(uid)) other.set(uid, 0);
    });
  }
  assertSafeMinor(itemsNet, 'itemsNet');

  // 2. General adjustments, weighted by pre-adjustment consumption.
  const beneficiaries = [...shared.keys()].sort(byRank);
  const preConsumption = beneficiaries.map((uid) => shared.get(uid)! + personal.get(uid)!);
  const adjustments = [...input.adjustments]
    .map((a, position) => ({ a, position }))
    .sort((x, y) => ADJUSTMENT_ORDER[x.a.kind] - ADJUSTMENT_ORDER[y.a.kind] || x.position - y.position)
    .map(({ a }) => a);

  let adjustmentsNet = 0;
  const adjustmentByMember = beneficiaries.map(() => 0);
  adjustments.forEach((adj, k) => {
    const signed = adjustmentSigned(adj);
    adjustmentsNet += signed;
    const amounts = allocateAdjustment(adj, signed, beneficiaries, preConsumption, seq - 1 + items.length + k);
    amounts.forEach((amt, i) => (adjustmentByMember[i]! += amt));
  });

  if (itemsNet + adjustmentsNet !== totalMinor) {
    throw new EngineError('NOT_RECONCILED', 'Items and adjustments do not add up to the total', {
      itemsNet,
      adjustmentsNet,
      totalMinor,
    });
  }

  // 3. Final charges per member; adjustments are split between shared and personal buckets.
  const chargesByMember: Record<Uid, MemberCharge> = {};
  const charges: number[] = [];
  beneficiaries.forEach((uid, i) => {
    const s = shared.get(uid)!;
    const p = personal.get(uid)!;
    const adj = adjustmentByMember[i]!;
    if (s + p + adj < 0) {
      throw new EngineError('INVALID_ALLOCATION', 'An adjustment leaves a negative charge', { uid });
    }
    const [adjShared, adjPersonal] = s + p === 0 ? [adj, 0] : allocateLargestRemainder(adj, [s, p], 0);
    const charge: MemberCharge = {
      sharedMinor: s + adjShared!,
      personalMinor: p + adjPersonal!,
      netMinor: s + p + adj,
    };
    assertSafeMinor(charge.netMinor, 'netMinor');
    chargesByMember[uid] = charge;
    charges.push(charge.netMinor);
  });

  return {
    chargesByMember,
    ledgerEffect: ledgerEffectOf(beneficiaries, charges, payers, totalMinor, seq),
  };
}

function validatePayers(payers: Payer[], rank: Map<Uid, number>, totalMinor: number): Payer[] {
  if (payers.length === 0) throw new EngineError('INVALID_ALLOCATION', 'At least one payer is required');
  const seen = new Set<Uid>();
  let sum = 0;
  for (const p of payers) {
    if (!rank.has(p.uid)) {
      throw new EngineError('PAYER_NOT_MEMBER', 'Payers must be accepted trip members', { uid: p.uid });
    }
    if (seen.has(p.uid)) throw new EngineError('INVALID_ALLOCATION', 'Duplicate payer', { uid: p.uid });
    seen.add(p.uid);
    assertSafeMinor(p.amountMinor, 'payers.amountMinor');
    if (p.amountMinor <= 0) {
      throw new EngineError('INVALID_ALLOCATION', 'Payer amounts must be positive', { uid: p.uid });
    }
    sum += p.amountMinor;
  }
  if (sum !== totalMinor) {
    throw new EngineError('NOT_RECONCILED', 'Payer contributions do not add up to the total', {
      payersMinor: sum,
      totalMinor,
    });
  }
  return [...payers];
}

function validateItems(input: ExpenseInput, rank: Map<Uid, number>): ExpenseItem[] {
  const { items, splitMode } = input;
  if (items.length === 0) throw new EngineError('INVALID_ALLOCATION', 'At least one item is required');
  if (splitMode === 'total' && items.length !== 1) {
    throw new EngineError('INVALID_ALLOCATION', 'splitMode "total" requires exactly one item');
  }
  const indexes = new Set<number>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.index) || item.index < 0 || indexes.has(item.index)) {
      throw new EngineError('INVALID_ALLOCATION', 'Item indexes must be unique non-negative integers', {
        itemId: item.id,
      });
    }
    indexes.add(item.index);
    assertSafeMinor(item.grossMinor, 'grossMinor');
    assertSafeMinor(item.discountMinor, 'discountMinor');
    assertNonNegativeMinor(item.grossMinor, 'grossMinor');
    assertNonNegativeMinor(item.discountMinor, 'discountMinor');
    if (item.discountMinor > item.grossMinor) {
      throw new EngineError('DISCOUNT_EXCEEDS_ITEM', 'Item discount exceeds its amount', { itemId: item.id });
    }
    if (item.beneficiaries.length === 0) {
      throw new EngineError('ITEM_WITHOUT_BENEFICIARY', 'Every item needs a beneficiary', { itemId: item.id });
    }
    if (new Set(item.beneficiaries).size !== item.beneficiaries.length) {
      throw new EngineError('INVALID_ALLOCATION', 'Duplicate beneficiary', { itemId: item.id });
    }
    for (const uid of item.beneficiaries) {
      if (!rank.has(uid)) {
        throw new EngineError('INVALID_ALLOCATION', 'Beneficiaries must be accepted trip members', {
          itemId: item.id,
          uid,
        });
      }
    }
    if (item.classification === 'personal' && item.beneficiaries.length !== 1) {
      throw new EngineError('INVALID_ALLOCATION', 'A personal item has exactly one beneficiary', {
        itemId: item.id,
      });
    }
  }
  return [...items].sort((a, b) => a.index - b.index);
}

function sharesFor<T extends { uid: Uid }>(shares: T[], beneficiaries: Uid[], itemId: string): T[] {
  const byUid = new Map(shares.map((s) => [s.uid, s]));
  if (byUid.size !== shares.length || byUid.size !== beneficiaries.length) {
    throw new EngineError('INVALID_ALLOCATION', 'Shares must cover each beneficiary exactly once', { itemId });
  }
  return beneficiaries.map((uid) => {
    const share = byUid.get(uid);
    if (!share) throw new EngineError('INVALID_ALLOCATION', 'Share for a non-beneficiary', { itemId, uid });
    return share;
  });
}

function allocateItem(item: ExpenseItem, beneficiaries: Uid[], net: number, rotation: number): number[] {
  const { allocation } = item;
  switch (allocation.mode) {
    case 'equal':
      return allocateLargestRemainder(net, beneficiaries.map(() => 1), rotation);
    case 'percent': {
      const shares = sharesFor(allocation.shares, beneficiaries, item.id);
      let total = 0;
      for (const s of shares) {
        if (!Number.isSafeInteger(s.bp) || s.bp < 0 || s.bp > FULL_PERCENT_BP) {
          throw new EngineError('INVALID_PERCENT', 'Percentages allow at most 2 decimals within 0–100 %', {
            itemId: item.id,
          });
        }
        total += s.bp;
      }
      if (total !== FULL_PERCENT_BP) {
        throw new EngineError('INVALID_PERCENT', 'Percentages must add up to exactly 100,00 %', {
          itemId: item.id,
          totalBp: total,
        });
      }
      return allocateLargestRemainder(net, shares.map((s) => s.bp), rotation);
    }
    case 'fixed': {
      const shares = sharesFor(allocation.shares, beneficiaries, item.id);
      let total = 0;
      for (const s of shares) {
        assertNonNegativeMinor(s.amountMinor, 'shares.amountMinor');
        total += s.amountMinor;
      }
      if (total !== net) {
        throw new EngineError('NOT_RECONCILED', 'Fixed shares do not add up to the item net amount', {
          itemId: item.id,
          sharesMinor: total,
          netMinor: net,
        });
      }
      return shares.map((s) => s.amountMinor);
    }
  }
}

function adjustmentSigned(adj: GeneralAdjustment): number {
  assertSafeMinor(adj.amountMinor, 'adjustments.amountMinor');
  if (adj.amountMinor <= 0) {
    throw new EngineError('INVALID_ALLOCATION', 'Adjustment amounts must be positive', { kind: adj.kind });
  }
  return adj.kind === 'discount' ? -adj.amountMinor : adj.amountMinor;
}

function allocateAdjustment(
  adj: GeneralAdjustment,
  signed: number,
  beneficiaries: Uid[],
  preConsumption: number[],
  rotation: number,
): number[] {
  switch (adj.mode) {
    case 'equal':
      return allocateLargestRemainder(signed, beneficiaries.map(() => 1), rotation);
    case 'proportional':
      if (preConsumption.every((c) => c === 0)) {
        throw new EngineError('INVALID_ALLOCATION', 'Proportional adjustment without consumption', {
          kind: adj.kind,
        });
      }
      return allocateLargestRemainder(signed, preConsumption, rotation);
    case 'manual': {
      const shares = adj.manualShares ?? [];
      const byUid = new Map<Uid, number>();
      let total = 0;
      for (const s of shares) {
        if (!beneficiaries.includes(s.uid) || byUid.has(s.uid)) {
          throw new EngineError('INVALID_ALLOCATION', 'Manual shares must target distinct beneficiaries', {
            kind: adj.kind,
            uid: s.uid,
          });
        }
        assertNonNegativeMinor(s.amountMinor, 'manualShares.amountMinor');
        byUid.set(s.uid, s.amountMinor);
        total += s.amountMinor;
      }
      if (total !== adj.amountMinor) {
        throw new EngineError('NOT_RECONCILED', 'Manual shares do not add up to the adjustment', {
          kind: adj.kind,
        });
      }
      const sign = signed < 0 ? -1 : 1;
      return beneficiaries.map((uid) => sign * (byUid.get(uid) ?? 0));
    }
  }
}

/**
 * Builds the ledger effect. Each beneficiary's charge is attributed to the payers in proportion
 * to their contribution (spec clarification Q1) using a controlled rounding that keeps BOTH row
 * sums (charges) and column sums (contributions) exact, so the pairwise view nets out to exactly
 * `paid − consumed` for every member.
 */
function ledgerEffectOf(
  beneficiaries: Uid[],
  charges: number[],
  payers: Payer[],
  totalMinor: number,
  seq: number,
): LedgerEffect {
  const netByMember: Record<Uid, number> = {};
  const add = (uid: Uid, v: number) => {
    const next = (netByMember[uid] ?? 0) + v;
    if (next === 0) delete netByMember[uid];
    else netByMember[uid] = next;
  };
  for (const p of payers) add(p.uid, p.amountMinor);
  beneficiaries.forEach((uid, i) => add(uid, -charges[i]!));

  const rows = beneficiaries.map((uid, i) => ({ uid, amount: BigInt(charges[i]!) })).filter((r) => r.amount > 0n);
  const cols = payers.map((p) => ({ uid: p.uid, amount: BigInt(p.amountMinor) }));
  const total = BigInt(totalMinor);

  const cells = rows.map((r) => cols.map((c) => (r.amount * c.amount) / total));
  const rems = rows.map((r) => cols.map((c) => (r.amount * c.amount) % total));
  const rowDef = rows.map((r, i) => r.amount - cells[i]!.reduce((a, b) => a + b, 0n));
  const colDef = cols.map((c, j) => c.amount - cells.reduce((a, row) => a + row[j]!, 0n));

  const R = rows.length;
  const C = cols.length;
  const order: [number, number][] = [];
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) order.push([i, j]);
  // Ties rotate with the expense sequence (rows) and with the row position (columns).
  const mod = (x: number, n: number) => ((x % n) + n) % n;
  const rot = seq - 1;
  order.sort(([i1, j1], [i2, j2]) => {
    const a = rems[i1]![j1]!;
    const b = rems[i2]![j2]!;
    if (a !== b) return a > b ? -1 : 1;
    const byRow = mod(i1 - rot, R) - mod(i2 - rot, R);
    if (byRow !== 0) return byRow;
    return mod(j1 - rot - i1, C) - mod(j2 - rot - i2, C);
  });
  for (const [i, j] of order) {
    if (rowDef[i]! > 0n && colDef[j]! > 0n && rems[i]![j]! > 0n) {
      cells[i]![j]! += 1n;
      rowDef[i]! -= 1n;
      colDef[j]! -= 1n;
    }
  }
  // Fallback (rare): settle any remaining deficits deterministically (north-west corner).
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C && rowDef[i]! > 0n; j++) {
      const d = rowDef[i]! < colDef[j]! ? rowDef[i]! : colDef[j]!;
      if (d > 0n) {
        cells[i]![j]! += d;
        rowDef[i]! -= d;
        colDef[j]! -= d;
      }
    }
  }

  const pairwise: Record<string, number> = {};
  rows.forEach((r, i) =>
    cols.forEach((c, j) => {
      const amount = cells[i]![j]!;
      if (r.uid !== c.uid && amount > 0n) pairwise[`${r.uid}>${c.uid}`] = toSafeNumber(amount);
    }),
  );
  return { netByMember, pairwise };
}

/**
 * Item-level allocation (net of item discount, before general adjustments) per beneficiary,
 * exactly as `computeExpense` does it. Used by refunds (feature 003).
 */
export function itemAllocations(input: ExpenseInput): Record<string, Record<Uid, number>> {
  const rank = memberRanking(input.members);
  const byRank = (a: Uid, b: Uid) => rank.get(a)! - rank.get(b)!;
  const out: Record<string, Record<Uid, number>> = {};
  for (const item of validateItems(input, rank)) {
    const beneficiaries = [...item.beneficiaries].sort(byRank);
    const amounts = allocateItem(item, beneficiaries, item.grossMinor - item.discountMinor, input.seq - 1 + item.index);
    out[item.id] = Object.fromEntries(beneficiaries.map((uid, i) => [uid, amounts[i]!]));
  }
  return out;
}
