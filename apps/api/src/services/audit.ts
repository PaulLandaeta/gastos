import type { Transaction } from '../firestore/client.js';

export interface AuditInput {
  tripId: string;
  actorUid: string;
  action: string;
  entityType: 'trip' | 'member' | 'invitation' | 'expense' | 'category' | 'settlement' | 'refund' | 'attachment' | 'scan';
  entityId: string;
  beforeVersion: number | null;
  afterVersion: number | null;
  correlationId: string;
  diff?: Record<string, unknown>;
}

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/g;

/** Masks e-mails (a***@domain) recursively; audit events must not hold full PII (Principle II). */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(EMAIL, '$1***@$2');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

/** Buffers an audit event write in the same transaction as the mutation it describes. */
export function writeAudit(tx: Transaction, input: AuditInput, now: Date): void {
  const id = crypto.randomUUID();
  tx.set(
    `trips/${input.tripId}/auditEvents/${id}`,
    {
      actorUid: input.actorUid,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeVersion: input.beforeVersion,
      afterVersion: input.afterVersion,
      timestamp: now,
      redactedDiff: redact(input.diff ?? {}) as Record<string, unknown>,
      correlationId: input.correlationId,
      schemaVersion: 1,
    },
    { exists: false },
  );
}
