import { EMPTY_LEDGER, combineEffects, type LedgerEffect } from 'finance-engine';
import type { Transaction } from '../firestore/client.js';

export const ledgerPath = (tripId: string) => `trips/${tripId}/projections/ledger`;

export interface LedgerProjection {
  effect: LedgerEffect;
  version: number;
  updateTime: string | null;
}

export async function readLedger(tx: Transaction, tripId: string): Promise<LedgerProjection> {
  const doc = await tx.get(ledgerPath(tripId));
  if (!doc) return { effect: EMPTY_LEDGER, version: 0, updateTime: null };
  return {
    effect: {
      netByMember: (doc.data['netByMember'] ?? {}) as Record<string, number>,
      pairwise: (doc.data['pairwise'] ?? {}) as Record<string, number>,
    },
    version: doc.data['version'] as number,
    updateTime: doc.updateTime,
  };
}

/** Applies an additive effect to the incremental projection (research R6). */
export function applyToLedger(
  tx: Transaction,
  tripId: string,
  current: LedgerProjection,
  delta: LedgerEffect,
  sourceRevision: number,
): void {
  const next = combineEffects(current.effect, delta);
  tx.set(
    ledgerPath(tripId),
    {
      netByMember: next.netByMember,
      pairwise: next.pairwise,
      sourceRevision,
      schemaVersion: 1,
      version: current.version + 1,
    },
    current.updateTime ? { updateTime: current.updateTime } : { exists: false },
  );
}
