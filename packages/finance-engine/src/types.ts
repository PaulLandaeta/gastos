export type Uid = string;

/** An accepted trip member. `joinOrder`: creator 0, then acceptance order (ties by uid). */
export interface Member {
  uid: Uid;
  joinOrder: number;
}

export type Allocation =
  | { mode: 'equal' }
  | { mode: 'fixed'; shares: { uid: Uid; amountMinor: number }[] }
  /** Basis points: 10000 = 100,00 %. */
  | { mode: 'percent'; shares: { uid: Uid; bp: number }[] };

export interface ExpenseItem {
  id: string;
  /** Stable position of the item inside the expense (0-based); drives the rounding rotation. */
  index: number;
  description?: string;
  grossMinor: number;
  discountMinor: number;
  classification: 'shared' | 'personal';
  beneficiaries: Uid[];
  allocation: Allocation;
}

export interface GeneralAdjustment {
  kind: 'discount' | 'tax' | 'tip';
  amountMinor: number;
  mode: 'proportional' | 'equal' | 'manual';
  manualShares?: { uid: Uid; amountMinor: number }[];
}

export interface Payer {
  uid: Uid;
  amountMinor: number;
}

export interface ExpenseInput {
  /** Immutable sequence number of the expense inside the trip, starting at 1. */
  seq: number;
  totalMinor: number;
  payers: Payer[];
  /** `total`: exactly one item carries the whole amount; `items`: invoice line items. */
  splitMode: 'total' | 'items';
  items: ExpenseItem[];
  adjustments: GeneralAdjustment[];
  /** Accepted members of the trip. */
  members: Member[];
}

export interface MemberCharge {
  sharedMinor: number;
  personalMinor: number;
  netMinor: number;
}

/**
 * Additive effect of an expense or payment on the trip ledger.
 * - `netByMember`: positive = creditor, negative = debtor; always sums to zero.
 * - `pairwise`: gross debts keyed `"debtorUid>creditorUid"` (not netted).
 * Zero entries are omitted.
 */
export interface LedgerEffect {
  netByMember: Record<Uid, number>;
  pairwise: Record<string, number>;
}

export interface ExpenseResult {
  chargesByMember: Record<Uid, MemberCharge>;
  ledgerEffect: LedgerEffect;
}

export interface Payment {
  fromUid: Uid;
  toUid: Uid;
  amountMinor: number;
  status: 'pending' | 'confirmed' | 'rejected';
}

export interface Transfer {
  fromUid: Uid;
  toUid: Uid;
  amountMinor: number;
}
