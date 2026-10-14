import type { CreateExpenseBody } from 'contracts';
import { openLocalDb } from './localDb';

/**
 * Pending expenses created offline (feature 005, data-model §PendingExpense). The idempotency key
 * is fixed when the expense is created and kept on every edit, so a resend never duplicates it.
 */
export type PendingStatus = 'pending' | 'sending' | 'needs_attention';

export interface PendingError {
  code: string;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export interface PendingExpense {
  localId: string;
  idempotencyKey: string;
  tripId: string;
  input: CreateExpenseBody;
  status: PendingStatus;
  attempts: number;
  nextAttemptAt: number | null;
  error: PendingError | null;
  /** false when the server refusal cannot be fixed by editing (only discard). */
  recoverable: boolean;
  confirmDuplicate: boolean;
  createdAt: number;
  updatedAt: number;
}

export class OutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxError';
  }
}

const channelName = (uid: string) => `outbox-${uid}`;
const localListeners = new Map<string, Set<() => void>>();

/** Notifies this tab and the other tabs of the same account that the queue changed. */
function notify(uid: string): void {
  for (const l of localListeners.get(uid) ?? []) l();
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(channelName(uid));
    ch.postMessage('changed');
    ch.close();
  }
}

export function subscribeOutbox(uid: string, listener: () => void): () => void {
  const set = localListeners.get(uid) ?? new Set();
  set.add(listener);
  localListeners.set(uid, set);
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName(uid)) : null;
  ch?.addEventListener('message', listener);
  return () => {
    set.delete(listener);
    ch?.close();
  };
}

export class Outbox {
  constructor(
    readonly uid: string,
    private readonly now: () => number = Date.now,
  ) {}

  private db() {
    return openLocalDb(this.uid);
  }

  /** `idempotencyKey`: reuse the key of an online attempt whose answer never arrived. */
  async add(tripId: string, input: CreateExpenseBody, idempotencyKey: string = crypto.randomUUID()): Promise<PendingExpense> {
    const t = this.now();
    const p: PendingExpense = {
      localId: crypto.randomUUID(),
      idempotencyKey,
      tripId,
      input,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      error: null,
      recoverable: true,
      confirmDuplicate: false,
      createdAt: t,
      updatedAt: t,
    };
    await (await this.db()).add('pendingExpenses', p);
    notify(this.uid);
    return p;
  }

  async get(localId: string): Promise<PendingExpense | undefined> {
    return (await this.db()).get('pendingExpenses', localId);
  }

  /** Every pending expense of the account (or one trip), oldest first. */
  async list(tripId?: string): Promise<PendingExpense[]> {
    const all = await (await this.db()).getAllFromIndex('pendingExpenses', 'createdAt');
    return tripId ? all.filter((p) => p.tripId === tripId) : all;
  }

  private async change(localId: string, fn: (p: PendingExpense) => PendingExpense): Promise<PendingExpense> {
    const db = await this.db();
    const tx = db.transaction('pendingExpenses', 'readwrite');
    const current = await tx.store.get(localId);
    if (!current) throw new OutboxError('El gasto pendiente ya no existe');
    const next = fn(current);
    await tx.store.put(next);
    await tx.done;
    notify(this.uid);
    return next;
  }

  /** FR-003a: the author edits a pending expense; same key, back to pending. */
  update(localId: string, input: CreateExpenseBody): Promise<PendingExpense> {
    return this.change(localId, (p) => {
      if (p.status === 'sending') throw new OutboxError('Se está enviando; espera un momento');
      if (!p.recoverable) throw new OutboxError('Este gasto ya no se puede enviar; solo puedes descartarlo');
      return { ...p, input, status: 'pending', error: null, attempts: 0, nextAttemptAt: null, updatedAt: this.now() };
    });
  }

  async discard(localId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('pendingExpenses', 'readwrite');
    const current = await tx.store.get(localId);
    if (current?.status === 'sending') throw new OutboxError('Se está enviando; espera un momento');
    await tx.store.delete(localId);
    await tx.done;
    notify(this.uid);
  }

  markSending(localId: string): Promise<PendingExpense> {
    return this.change(localId, (p) => ({ ...p, status: 'sending', updatedAt: this.now() }));
  }

  /** Transient failure: stays pending until `nextAttemptAt`. */
  markRetry(localId: string, nextAttemptAt: number, countAttempt = true): Promise<PendingExpense> {
    return this.change(localId, (p) => ({
      ...p,
      status: 'pending',
      attempts: countAttempt ? p.attempts + 1 : p.attempts,
      nextAttemptAt,
      updatedAt: this.now(),
    }));
  }

  markAttention(localId: string, error: PendingError, recoverable: boolean): Promise<PendingExpense> {
    return this.change(localId, (p) => ({ ...p, status: 'needs_attention', error, recoverable, updatedAt: this.now() }));
  }

  /** «Enviar igualmente» after a possible duplicate (RF-22). */
  confirmDuplicate(localId: string): Promise<PendingExpense> {
    return this.change(localId, (p) => ({
      ...p,
      status: 'pending',
      confirmDuplicate: true,
      error: null,
      nextAttemptAt: null,
      updatedAt: this.now(),
    }));
  }

  /** Synced: the server now holds the expense. */
  async remove(localId: string): Promise<void> {
    await (await this.db()).delete('pendingExpenses', localId);
    notify(this.uid);
  }

  /** A `sending` left behind by a closed app goes back to pending (the key makes the resend safe). */
  async resetOrphans(): Promise<number> {
    const orphans = (await this.list()).filter((p) => p.status === 'sending');
    for (const p of orphans) await this.change(p.localId, (x) => ({ ...x, status: 'pending' }));
    return orphans.length;
  }
}
