import type { Outbox, PendingExpense } from './outbox';

/**
 * Sends pending expenses (feature 005, FR-004/FR-005): oldest first, one at a time, with the stored
 * Idempotency-Key. Transient failures back off; business refusals wait for the user
 * («requiere atención») and are never resolved against the server automatically (RF-36).
 */
export type ErrorKind = 'retry' | 'reauth' | 'fixable' | 'fatal';

/** The user can only discard: the trip or the access is gone. */
const FATAL = new Set(['FORBIDDEN', 'NOT_FOUND', 'TRIP_READ_ONLY', 'TRIP_NOT_READY', 'EMAIL_NOT_VERIFIED']);

export function classifyError(error: unknown): ErrorKind {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  if (code === 'UNAUTHENTICATED') return 'reauth';
  // CONFLICT on create means transaction contention: the same key is safe to resend.
  if (code === 'NETWORK' || code === 'CONFLICT' || status === undefined || status === 0 || status >= 500 || status === 429) return 'retry';
  return code && FATAL.has(code) ? 'fatal' : 'fixable';
}

const BASE_MS = 2_000;
const MAX_MS = 5 * 60_000;
export const backoffMs = (attempts: number) => Math.min(BASE_MS * 2 ** attempts, MAX_MS);

export interface SyncDeps {
  outbox: Outbox;
  send: (p: PendingExpense) => Promise<unknown>;
  now?: () => number;
  onSynced?: (p: PendingExpense) => void;
  /** Ignore the backoff (manual «Reintentar»). */
  force?: boolean;
}

export interface SyncResult {
  sent: number;
  retry: number;
  attention: number;
}

const running = new Set<string>();

/** One run at a time per account, across tabs when the Web Locks API exists. */
async function withLock(uid: string, fn: () => Promise<SyncResult>): Promise<SyncResult> {
  const idle: SyncResult = { sent: 0, retry: 0, attention: 0 };
  const name = `outbox-sync-${uid}`;
  if (running.has(name)) return idle;
  running.add(name);
  try {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (!locks) return await fn();
    return ((await locks.request(name, { ifAvailable: true }, (lock) => (lock ? fn() : idle))) as SyncResult) ?? idle;
  } finally {
    running.delete(name);
  }
}

export function syncOutbox(deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now ?? Date.now;
  return withLock(deps.outbox.uid, async () => {
    const result: SyncResult = { sent: 0, retry: 0, attention: 0 };
    const queue = (await deps.outbox.list()).filter((p) => p.status === 'pending');
    for (const p of queue) {
      // Creation order (FR-004): an expense waiting for its backoff holds back the newer ones.
      if (!deps.force && p.nextAttemptAt !== null && p.nextAttemptAt > now()) break;
      const sending = await deps.outbox.markSending(p.localId);
      try {
        await deps.send(sending);
        await deps.outbox.remove(p.localId);
        result.sent++;
        deps.onSynced?.(sending);
      } catch (error) {
        const kind = classifyError(error);
        if (kind === 'retry' || kind === 'reauth') {
          const counted = kind === 'retry';
          await deps.outbox.markRetry(p.localId, now() + (counted ? backoffMs(p.attempts) : 0), counted);
          result.retry++;
          break; // the network or the session is down: the rest would fail the same way
        }
        const e = error as { code?: string; message?: string; details?: Record<string, unknown> };
        await deps.outbox.markAttention(
          p.localId,
          { code: e.code ?? 'INTERNAL', message: e.message ?? 'Error', details: e.details },
          kind === 'fixable',
        );
        result.attention++;
      }
    }
    return result;
  });
}
