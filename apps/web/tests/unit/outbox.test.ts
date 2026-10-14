import type { CreateExpenseBody } from 'contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteLocalDb } from '../../src/features/offline/localDb';
import { Outbox, OutboxError } from '../../src/features/offline/outbox';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function body(description: string, totalMinor = 1000): CreateExpenseBody {
  return {
    description,
    transactionDate: '2026-11-02',
    categoryId: 'default-food',
    totalMinor,
    payers: [{ uid: 'ana', amountMinor: totalMinor }],
    splitMode: 'total',
    items: [
      { id: 'i1', index: 0, grossMinor: totalMinor, discountMinor: 0, quantity: 1, classification: 'shared', beneficiaries: ['ana', 'juan'], allocation: { mode: 'equal' } },
    ],
    adjustments: [],
  };
}

let clock = 1_000;
const now = () => clock;

beforeEach(async () => {
  clock = 1_000;
  await deleteLocalDb('ana');
  await deleteLocalDb('juan');
});

describe('outbox (US1, FR-003/FR-003a)', () => {
  it('stores a pending expense with a fixed v4 idempotency key', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('Cena'));
    expect(p).toMatchObject({ tripId: 't1', status: 'pending', attempts: 0, error: null, confirmDuplicate: false });
    expect(p.idempotencyKey).toMatch(UUID_V4);
    expect(await outbox.list('t1')).toHaveLength(1);
  });

  it('editing keeps the same idempotency key and resets an attention state', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('Cena'));
    await outbox.markSending(p.localId);
    await outbox.markAttention(p.localId, { code: 'CATEGORY_INACTIVE', message: 'x' }, true);
    clock = 2_000;
    const edited = await outbox.update(p.localId, body('Cena corregida', 1500));
    expect(edited.idempotencyKey).toBe(p.idempotencyKey);
    expect(edited).toMatchObject({ status: 'pending', error: null, attempts: 0, updatedAt: 2_000 });
    expect(edited.input.description).toBe('Cena corregida');
  });

  it('cannot edit or discard while sending', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('Cena'));
    await outbox.markSending(p.localId);
    await expect(outbox.update(p.localId, body('X'))).rejects.toBeInstanceOf(OutboxError);
    await expect(outbox.discard(p.localId)).rejects.toBeInstanceOf(OutboxError);
  });

  it('discard removes it; non-recoverable attention can only be discarded', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('Cena'));
    await outbox.markSending(p.localId);
    await outbox.markAttention(p.localId, { code: 'TRIP_READ_ONLY', message: 'closed' }, false);
    await expect(outbox.update(p.localId, body('X'))).rejects.toBeInstanceOf(OutboxError);
    await outbox.discard(p.localId);
    expect(await outbox.list()).toEqual([]);
  });

  it('an orphaned sending (app closed mid-request) goes back to pending', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('Cena'));
    await outbox.markSending(p.localId);
    expect(await outbox.resetOrphans()).toBe(1);
    expect((await outbox.get(p.localId))?.status).toBe('pending');
  });

  it('lists in creation order and filters by trip', async () => {
    const outbox = new Outbox('ana', now);
    clock = 3_000;
    await outbox.add('t1', body('B'));
    clock = 1_000;
    await outbox.add('t1', body('A'));
    clock = 2_000;
    await outbox.add('t2', body('Other'));
    expect((await outbox.list()).map((p) => p.input.description)).toEqual(['A', 'Other', 'B']);
    expect((await outbox.list('t1')).map((p) => p.input.description)).toEqual(['A', 'B']);
  });

  it('is isolated per account', async () => {
    await new Outbox('ana', now).add('t1', body('Ana'));
    expect(await new Outbox('juan', now).list()).toEqual([]);
  });

  it('confirming a possible duplicate flags the resend', async () => {
    const outbox = new Outbox('ana', now);
    const p = await outbox.add('t1', body('Cena'));
    await outbox.markSending(p.localId);
    await outbox.markAttention(p.localId, { code: 'POSSIBLE_DUPLICATE', message: 'dup' }, true);
    const resent = await outbox.confirmDuplicate(p.localId);
    expect(resent).toMatchObject({ status: 'pending', confirmDuplicate: true, idempotencyKey: p.idempotencyKey });
  });
});
