import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listBackupDates, pruneBackups, runBackup } from '../src/backup.js';
import { COLLECTION_IDS } from '../src/collections.js';
import { parseKey } from '../src/crypto.js';
import { opsEnv } from '../src/env.js';
import { Firestore } from '../../api/src/firestore/client.js';
import { RawFirestore } from '../src/firestoreRaw.js';
import { readBackup, runRestore } from '../src/restore.js';
import { DirStore } from '../src/store.js';
import { apiEnv, AUTH, call, clearAuth, clearFirestore, createAuthUser, FIRESTORE, type TestUser } from './helpers.js';

const env = opsEnv({ FIRESTORE_EMULATOR_HOST: FIRESTORE, FIREBASE_AUTH_EMULATOR_HOST: AUTH, FIREBASE_PROJECT_ID: 'demo-gastos' });
const key = parseKey(randomBytes(32).toString('base64'));
const ana: TestUser = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' };
const pedro: TestUser = { uid: 'uid-pedro', email: 'pedro@example.com', name: 'Pedro' };
const juan: TestUser = { uid: 'uid-juan', email: 'juan@example.com', name: 'Juan' };

let tripId = '';

const expense = (payer: TestUser, beneficiaries: TestUser[], totalMinor: number, description = 'Cena') => ({
  description,
  transactionDate: '2026-11-01',
  categoryId: 'default-food',
  totalMinor,
  payers: [{ uid: payer.uid, amountMinor: totalMinor }],
  splitMode: 'total',
  items: [{ id: 't', index: 0, grossMinor: totalMinor, discountMinor: 0, classification: 'shared', beneficiaries: beneficiaries.map((b) => b.uid), allocation: { mode: 'equal' } }],
  adjustments: [],
});

async function nets() {
  const res = await call(ana, 'GET', `/v1/trips/${tripId}/balances?view=original`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json.netByMember as { uid: string; netMinor: number }[];
}

async function snapshot() {
  const fs = new RawFirestore(env);
  const out = new Map<string, string>();
  for (const id of COLLECTION_IDS) for await (const d of fs.collectionGroup(id)) out.set(d.name, JSON.stringify(d.fields));
  return out;
}

/** Every collection id that exists, found by walking listCollectionIds (completeness check). */
async function walkCollectionIds(fs: RawFirestore, parent = '', found = new Set<string>()) {
  for (const id of await fs.listCollectionIds(parent)) {
    found.add(id);
    const res = await fetch(`http://${FIRESTORE}/v1/${fs.root}/${parent ? `${parent}/` : ''}${id}?pageSize=300&showMissing=true`, { headers: { authorization: 'Bearer owner' } });
    const body = (await res.json()) as { documents?: { name: string }[] };
    for (const d of body.documents ?? []) await walkCollectionIds(fs, d.name.slice(fs.root.length + 1), found);
  }
  return found;
}

beforeAll(async () => {
  await clearFirestore();
  await clearAuth();
  for (const u of [ana, pedro, juan]) {
    await createAuthUser(u);
    expect((await call(u, 'POST', '/v1/me/sync')).status).toBe(200);
  }
  const created = await call(ana, 'POST', '/v1/trips', { name: 'Salar', startDate: '2026-11-01', endDate: '2026-11-05', currency: 'BOB', inviteEmails: [pedro.email, juan.email] });
  tripId = created.json.trip.id;
  for (const u of [pedro, juan]) expect((await call(u, 'POST', `/v1/trips/${tripId}/invitations/accept`)).status).toBe(200);
  const key1 = { 'idempotency-key': crypto.randomUUID() };
  expect((await call(pedro, 'POST', `/v1/trips/${tripId}/expenses`, expense(pedro, [ana, pedro, juan], 3000, 'Taxi'), key1)).status).toBe(201);
  expect((await call(ana, 'POST', `/v1/trips/${tripId}/expenses`, expense(ana, [ana, juan], 1001), { 'idempotency-key': crypto.randomUUID() })).status).toBe(201);
  // Technical configuration (AI quotas) lives in a top-level `config` collection.
  await new Firestore(env).runTransaction(async (tx) => tx.set('config/ai', { tripDay: 20, globalDay: 100 }));
  const s = await call(juan, 'POST', `/v1/trips/${tripId}/settlements`, { toUid: pedro.uid, amountMinor: 500 }, { 'idempotency-key': crypto.randomUUID() });
  expect((await call(pedro, 'POST', `/v1/trips/${tripId}/settlements/${s.json.settlement.id}/confirm`, { expectedVersion: 1 })).status).toBe(200);
}, 60_000);

describe('backup and restore drill (FR-017–FR-020, SC-005)', () => {
  it('exports every collection, restores an identical database and the same balances', async () => {
    const store = new DirStore(await mkdtemp(join(tmpdir(), 'gvb-')));
    const before = await snapshot();
    const balances = await nets();
    expect(before.size).toBeGreaterThan(20);

    // Completeness: every collection that exists is in the export list.
    const existing = await walkCollectionIds(new RawFirestore(env));
    expect([...existing].filter((id) => !(COLLECTION_IDS as readonly string[]).includes(id))).toEqual([]);

    const manifest = await runBackup(env, store, key, new Date('2026-10-14T03:30:00Z'));
    expect(manifest).toMatchObject({ date: '2026-10-14', kind: 'daily', docCount: before.size });
    // The stored file is encrypted: no readable names or e-mails.
    const raw = (await store.get('firestore/2026-10-14/backup.gvb'))!;
    for (const pii of ['Pedro', 'pedro@example.com', 'Salar']) expect(raw.includes(Buffer.from(pii))).toBe(false);

    await clearFirestore();
    expect((await new RawFirestore(env).listCollectionIds('')).length).toBe(0);
    const t0 = Date.now();
    const result = await runRestore(env, store, key, { confirmProject: 'demo-gastos' });
    expect(Date.now() - t0).toBeLessThan(60 * 60 * 1000);
    expect(result).toEqual({ date: '2026-10-14', documents: before.size, reappliedDeletions: 0 });

    const after = await snapshot();
    expect(after.size).toBe(before.size);
    for (const [name, fields] of before) expect(after.get(name), name).toBe(fields);
    expect(await nets()).toEqual(balances);
  });

  it('refuses the wrong project, a non-empty target and a tampered copy', async () => {
    const store = new DirStore(await mkdtemp(join(tmpdir(), 'gvb-')));
    await runBackup(env, store, key, new Date('2026-10-15T03:30:00Z'));
    await expect(runRestore(env, store, key, { confirmProject: 'gastos-prod' })).rejects.toThrow(/target project/);
    await expect(runRestore(env, store, key, { confirmProject: 'demo-gastos' })).rejects.toThrow(/not empty/);
    const other = parseKey(randomBytes(32).toString('base64'));
    await expect(readBackup(store, other)).rejects.toThrow();
  });

  it('a deletion after the copy is re-applied on restore (registry lost with the database)', async () => {
    const store = new DirStore(await mkdtemp(join(tmpdir(), 'gvb-')));
    await runBackup(env, store, key, new Date('2026-10-16T03:30:00Z'));
    const balances = await nets();

    // Pedro deletes the account after the backup: the Auth account disappears.
    const del = await call(pedro, 'POST', '/v1/me/deletion', { confirm: 'BORRAR' });
    expect(del.json.status).toBe('completed');

    // Disaster: the database is lost; the copy still holds Pedro's data.
    await clearFirestore();
    const result = await runRestore(env, store, key, { confirmProject: 'demo-gastos' });
    expect(result.reappliedDeletions).toBe(1);

    const docs = await snapshot();
    const leaks = [...docs].filter(([, f]) => f.includes('Pedro') || f.includes('pedro@example.com')).map(([n]) => n);
    expect(leaks).toEqual([]);
    expect(await nets()).toEqual(balances);
    const member = (await call(ana, 'GET', `/v1/trips/${tripId}`)).json.members.find((m: { key: string }) => m.key === pedro.uid);
    expect(member.displayName).toBe('Participante eliminado 1');
  });

  it('prunes copies outside 7 daily + 4 weekly', async () => {
    const store = new DirStore(await mkdtemp(join(tmpdir(), 'gvb-')));
    for (let i = 0; i < 12; i++) await store.put(`firestore/2026-09-${String(20 + i > 30 ? 30 : 20 + i).padStart(2, '0')}/manifest.json`, Buffer.from('{}'), 'application/json');
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
      await store.put(`firestore/${d}/manifest.json`, Buffer.from('{}'), 'application/json');
      await store.put(`firestore/${d}/backup.gvb`, Buffer.from('x'), 'application/octet-stream');
    }
    const removed = await pruneBackups(store, new Date('2026-10-08T04:00:00Z'));
    const left = await listBackupDates(store);
    expect(left).toEqual(['2026-09-20', '2026-09-27', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(removed).toContain('2026-10-01');
    void apiEnv;
  });
});
