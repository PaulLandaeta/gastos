import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore, FirestoreError } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';

const db = new Firestore(env);

beforeAll(clearFirestore);

describe('Firestore REST client (emulator)', () => {
  it('get returns null for missing documents', async () => {
    expect(await db.get('things/missing')).toBeNull();
  });

  it('commits writes in a transaction and reads them back', async () => {
    await db.runTransaction(async (tx) => {
      expect(await tx.get('things/a')).toBeNull();
      tx.set('things/a', { n: 1, label: 'uno' }, { exists: false });
      tx.set('things/b', { n: 2, label: 'dos' });
    });
    const a = await db.get('things/a');
    expect(a?.data).toEqual({ n: 1, label: 'uno' });
    expect(a?.id).toBe('a');
    const many = await db.batchGet(['things/a', 'things/b', 'things/zzz']);
    expect(many.get('things/b')?.data['n']).toBe(2);
    expect(many.get('things/zzz')).toBeNull();
  });

  it('update merges only the given top-level fields', async () => {
    await db.runTransaction(async (tx) => {
      tx.update('things/a', { label: 'one' });
    });
    expect((await db.get('things/a'))?.data).toEqual({ n: 1, label: 'one' });
  });

  it('a failed precondition aborts the whole commit', async () => {
    await expect(
      db.runTransaction(async (tx) => {
        tx.set('things/c', { n: 3 });
        tx.set('things/a', { n: 99 }, { exists: false });
      }),
    ).rejects.toBeInstanceOf(FirestoreError);
    expect(await db.get('things/c')).toBeNull();
    expect((await db.get('things/a'))?.data['n']).toBe(1);
  });

  it('runQuery filters a collection', async () => {
    const docs = await db.query('things', { where: [['n', '>=', 2]], orderBy: [['n', 'asc']] });
    expect(docs.map((d) => d.id)).toEqual(['b']);
  });

  it('retries the transaction function when the commit is ABORTED', async () => {
    let commits = 0;
    const flaky: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith(':commit') && commits++ === 0) {
        return new Response(JSON.stringify({ error: { code: 409, status: 'ABORTED', message: 'contention' } }), {
          status: 409,
        });
      }
      return fetch(input, init);
    };
    const flakyDb = new Firestore(env, flaky);
    let attempts = 0;
    const result = await flakyDb.runTransaction(async (tx) => {
      attempts += 1;
      const doc = await tx.get('counters/x');
      const value = ((doc?.data['value'] as number | undefined) ?? 0) + 1;
      tx.set('counters/x', { value });
      return value;
    });
    expect(attempts).toBe(2);
    expect(result).toBe(1);
    expect((await db.get('counters/x'))?.data['value']).toBe(1);
  });

  it('delete removes documents', async () => {
    await db.runTransaction(async (tx) => tx.delete('things/b'));
    expect(await db.get('things/b')).toBeNull();
  });
});
