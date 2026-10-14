import { allocateLargestRemainder } from './allocate.js';
import { itemAllocations } from './expense.js';
import { EngineError, assertSafeMinor } from './money.js';
import { memberRanking } from './order.js';
import type { ExpenseInput, LedgerEffect, Member, Uid } from './types.js';

export interface ItemRefundable {
  quantity: number;
  netMinor: number;
  adjustmentShareMinor: number;
  /** Maximum refundable for the whole item: net + its share of general adjustments. */
  maxMinor: number;
}

/** General adjustments (signed) split among items in proportion to their net (RF-37, spec Q2). */
export function itemAdjustmentShares(input: ExpenseInput): Record<string, number> {
  const items = [...input.items].sort((a, b) => a.index - b.index);
  const nets = items.map((i) => i.grossMinor - i.discountMinor);
  const total = input.adjustments.reduce((a, x) => a + (x.kind === 'discount' ? -x.amountMinor : x.amountMinor), 0);
  if (total === 0 || nets.every((n) => n === 0)) return Object.fromEntries(items.map((i) => [i.id, 0]));
  const shares = allocateLargestRemainder(total, nets, input.seq - 1);
  return Object.fromEntries(items.map((i, k) => [i.id, shares[k]!]));
}

export function itemRefundable(input: ExpenseInput, itemId: string, quantity: number): ItemRefundable {
  const item = input.items.find((i) => i.id === itemId);
  if (!item) throw new EngineError('INVALID_ALLOCATION', 'Unknown item', { itemId });
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new EngineError('INVALID_ALLOCATION', 'Invalid quantity');
  const netMinor = item.grossMinor - item.discountMinor;
  const adjustmentShareMinor = itemAdjustmentShares(input)[itemId] ?? 0;
  return { quantity, netMinor, adjustmentShareMinor, maxMinor: Math.max(0, netMinor + adjustmentShareMinor) };
}

/**
 * Suggested amount for refunding `quantity` more units: proportional to the item's maximum,
 * rounded down; the refund that completes the item takes the residue, so the total never
 * exceeds `maxMinor`.
 */
export function suggestRefund(
  r: ItemRefundable,
  already: { quantity: number; amountMinor: number },
  quantity: number,
): number {
  const remaining = r.maxMinor - already.amountMinor;
  if (already.quantity + quantity >= r.quantity) return Math.max(0, remaining);
  const proportional = Number((BigInt(r.maxMinor) * BigInt(quantity)) / BigInt(r.quantity));
  return Math.max(0, Math.min(proportional, remaining));
}

/** The item's net allocation per beneficiary (weights for distributing a refund). */
export function itemChargesByMember(input: ExpenseInput, itemId: string): Record<Uid, number> {
  const all = itemAllocations(input);
  const charges = all[itemId];
  if (!charges) throw new EngineError('INVALID_ALLOCATION', 'Unknown item', { itemId });
  return charges;
}

export interface RefundEffectInput {
  amountMinor: number;
  /** Participant who received the money back from the merchant. */
  recipientUid: Uid;
  /** Item allocation per beneficiary; the refund reduces consumption in the same proportion. */
  itemCharges: Record<Uid, number>;
  rotation: number;
  members: Member[];
}

/**
 * Compensating movement of a refund (RF-37): beneficiaries consume `share_b` less and the recipient
 * holds `amount` on behalf of the group. Zero-sum by construction; pairwise `recipient>b` keeps the
 * original debt view netting exactly.
 */
export function refundEffect(input: RefundEffectInput): { ledgerEffect: LedgerEffect; chargesDelta: Record<Uid, number> } {
  const { amountMinor, recipientUid, itemCharges, rotation, members } = input;
  assertSafeMinor(amountMinor, 'amountMinor');
  if (amountMinor <= 0) throw new EngineError('INVALID_ALLOCATION', 'Refund amount must be positive');
  const rank = memberRanking(members);
  if (!rank.has(recipientUid)) throw new EngineError('PAYER_NOT_MEMBER', 'The recipient must be a trip member');
  const beneficiaries = Object.keys(itemCharges).sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || (a < b ? -1 : 1));
  if (beneficiaries.length === 0) throw new EngineError('ITEM_WITHOUT_BENEFICIARY', 'The item has no beneficiaries');
  const weights = beneficiaries.map((b) => itemCharges[b]!);
  const shares = allocateLargestRemainder(amountMinor, weights.every((w) => w === 0) ? weights.map(() => 1) : weights, rotation);

  const chargesDelta: Record<Uid, number> = {};
  const netByMember: Record<Uid, number> = { [recipientUid]: -amountMinor };
  const pairwise: Record<string, number> = {};
  beneficiaries.forEach((b, i) => {
    const share = shares[i]!;
    if (share === 0) return;
    chargesDelta[b] = share;
    netByMember[b] = (netByMember[b] ?? 0) + share;
    if (b !== recipientUid) pairwise[`${recipientUid}>${b}`] = share;
  });
  for (const k of Object.keys(netByMember)) if (netByMember[k] === 0) delete netByMember[k];
  return { ledgerEffect: { netByMember, pairwise }, chargesDelta };
}
