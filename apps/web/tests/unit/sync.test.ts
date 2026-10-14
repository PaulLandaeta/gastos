import type { CreateExpenseBody } from 'contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteLocalDb } from '../../src/features/offline/localDb';
import { Outbox, type PendingExpense } from '../../src/features/offline/outbox';
import { backoffMs, classifyError, syncOutbox } from '../../src/features/offline/sync';

const err = (code: string, status: number) => Object.assign(new Error(code), { code, status });

function body(description: string): CreateExpenseBody {
  return {
    description,
    transactionDate: '2026-11-02',
    categoryId: 'default-food',
    totalMinor: 1000,
    payers: [{ uid: 'ana', amountMinor: 1000 }],
    splitMode: 'total',
    items: [{ id: 'i1', index: 0, grossMinor: 1000, discountMinor: 0, quantity: 1, classification: 'shared', beneficiaries: ['ana'], allocation: { mode: 'equal' } }],
    adjustments: [],
  };
}

let clock = 10_000;
const now = () => clock;

beforeEach(async () => {
  clock = 10_000;
  await deleteLocalDb('ana');
});

describe('error classification (data-model)', () => {
  it.each([
    ['NETWORK', 0, 'retry'],
    ['INTERNAL', 500, 'retry'],
    ['AI_UNAVAILABLE', 503, 'retry'],
    ['AI_QUOTA_EXCEEDED', 429, 'retry'],
    ['CONFLICT', 409, 'retry'],
    ['UNAUTHENTICATED', 401, 'reauth'],
    ['FORBIDDEN', 403, 'fatal'],
    ['NOT_FOUND', 404, 'fatal'],
    ['TRIP_READ_ONLY', 409, 'fatal'],
    ['TRIP_NOT_READY', 409, 'fatal'],
    ['VALIDATION_FAILED', 422, 'fixable'],
    ['NOT_RECONCILED', 422, 'fixable'],
    ['INVALID_ALLOCATION', 422, 'fixable'],
    ['PAYER_NOT_MEMBER', 422, 'fixable'],
    ['CATEGORY_INACTIVE', 409, 'fixable'],
    ['PARTICIPANTS_LOCKED', 409, 'fixable'],
    ['CURRENCY_LOCKED', 409, 'fixable'],
    ['POSSIBLE_DUPLICATE', 409, 'fixable'],
  ])('%s (%i) → %s', (code, status, kind) => {
    expect(classifyError(err(code, status))).toBe(kind);
  });

  it('unknown errors without a status are retried', () => {
    expect(classifyError(new Error('boom'))).toBe('retry');
  });

  it('backoff doubles from 2 s up to 5 min', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(backoffMs(20)).toBe(300_000);
  });
});

describe('syncOutbox (FR-004/FR-005)', () => {
  it('sends in creation order with the stored key and removes each on success', async () => {
    const outbox = new Outbox('ana', now);
    const a = await outbox.add('t1', body('A'));
    clock += 1;
    const b = await outbox.add('t1', body('B'));
    const sent: string[] = [];
    const send = vi.fn(async (p: PendingExpense) => void sent.push(`${p.input.description}:${p.idempotencyKey}`));
    const synced = vi.fn();
    const r = await syncOutbox({ outbox, send, now, onSynced: synced });
    expect(sent).toEqual([`A:${a.idempotencyKey}`, `B:${b.idempotencyKey}`]);
    expect(r).toEqual({ sent: 2, retry: 0, attention: 0 });
    expect(await outbox.list()).toEqual([]);
    expect(synced).toHaveBeenCalledTimes(2);
  });

  it('a network failure keeps it pending with backoff and stops the run', async () => {
    const outbox = new Outbox('ana', now);
    const a = await outbox.add('t1', body('A'));
    clock += 1;
    await outbox.add('t1', body('B'));
    clock -= 1;
    const send = vi.fn(async () => {
      throw err('NETWORK', 0);
    });
    const r = await syncOutbox({ outbox, send, now });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.retry).toBe(1);
    const stored = await outbox.get(a.localId);
    expect(stored).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: 12_000 });
    // Not due yet: nothing is sent; a forced retry ignores the backoff.
    send.mockClear();
    await syncOutbox({ outbox, send, now });
    expect(send).not.toHaveBeenCalled();
    await syncOutbox({ outbox, send, now, force: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('business rejections go to needs_attention with the reason; fatal ones are not recoverable', async () => {
    const outbox = new Outbox('ana', now);
    const fixable = await outbox.add('t1', body('A'));
    clock += 1;
    const fatal = await outbox.add('t1', body('B'));
    const send = vi.fn(async (p: PendingExpense) => {
      throw p.input.description === 'A' ? err('CATEGORY_INACTIVE', 409) : err('TRIP_READ_ONLY', 409);
    });
    const r = await syncOutbox({ outbox, send, now });
    expect(r).toEqual({ sent: 0, retry: 0, attention: 2 });
    expect(await outbox.get(fixable.localId)).toMatchObject({ status: 'needs_attention', recoverable: true, error: { code: 'CATEGORY_INACTIVE' } });
    expect(await outbox.get(fatal.localId)).toMatchObject({ status: 'needs_attention', recoverable: false, error: { code: 'TRIP_READ_ONLY' } });
    // needs_attention is never resent automatically.
    send.mockClear();
    await syncOutbox({ outbox, send, now, force: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('a confirmed possible duplicate is resent with confirmDuplicate and the same key', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('A'));
    const send = vi.fn(async () => {
      throw err('POSSIBLE_DUPLICATE', 409);
    });
    await syncOutbox({ outbox, send, now });
    await outbox.confirmDuplicate(p.localId);
    const ok = vi.fn(async (_p: PendingExpense) => undefined);
    await syncOutbox({ outbox, send: ok, now });
    expect(ok.mock.calls[0]![0]).toMatchObject({ confirmDuplicate: true, idempotencyKey: p.idempotencyKey });
  });

  it('UNAUTHENTICATED keeps the expense pending without counting an attempt', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('A'));
    await syncOutbox({ outbox, send: async () => Promise.reject(err('UNAUTHENTICATED', 401)), now });
    expect(await outbox.get(p.localId)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('two concurrent runs never send the same expense twice', async () => {
    const outbox = new Outbox('ana', now);
    await outbox.add('t1', body('A'));
    clock += 1;
    await outbox.add('t1', body('B'));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(async () => gate);
    const first = syncOutbox({ outbox, send, now });
    const second = syncOutbox({ outbox, send, now });
    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await outbox.list()).toEqual([]);
  });
});
