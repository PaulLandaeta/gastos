import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { canViewExpense } from '../../src/services/visibility.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, equalExpense, postExpense } from '../helpers/trips.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis } = users;

beforeAll(clearFirestore);

/**
 * Feature 005: notifications and exports must apply the same visibility function as the app
 * (RF-38). For every member of a trip with private expenses, what reaches them through those
 * channels is a subset of what `canViewExpense` allows.
 */
describe('cross-channel privacy (SC-005, SC-008)', () => {
  it('notifications and exports never carry details of expenses a member cannot see', async () => {
    const trip = await activeTrip(ana, [pedro, juan, luis]);
    // Luis becomes admin (sees everything); the rest are plain members.
    const current = (await call(ana, 'GET', `/v1/trips/${trip.id}`)).json.trip;
    const role = await call(ana, 'PUT', `/v1/trips/${trip.id}/members/${luis.uid}/role`, {
      body: { role: 'admin', expectedVersion: current.version },
    });
    expect(role.status, JSON.stringify(role.json)).toBe(200);

    const specs: [typeof ana, string[], string][] = [
      [ana, [ana.uid, juan.uid], 'Privado Ana-Juan'],
      [pedro, [pedro.uid], 'Personal de Pedro'],
      [juan, [ana.uid, pedro.uid, juan.uid, luis.uid], 'Compartido'],
      [ana, [ana.uid], 'Solo Ana'],
    ];
    for (const [i, [author, beneficiaries, description]] of specs.entries()) {
      // Distinct totals: equal ones would (correctly) trigger the duplicate warning.
      const r = await postExpense(author, trip.id, { ...equalExpense(author.uid, beneficiaries, 1200 + i), description });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
    }
    const stored = await db.query(`trips/${trip.id}/expenses`);
    const memberDocs = await db.query(`trips/${trip.id}/members`);

    for (const u of [ana, pedro, juan, luis]) {
      const me = memberDocs.find((m) => m.data['uid'] === u.uid)!.data as never;
      const visible = new Set(stored.filter((d) => canViewExpense(me, d.data as never)).map((d) => d.id));
      const hiddenTexts = stored.filter((d) => !visible.has(d.id)).map((d) => d.data['description'] as string);

      const exported = (await call(u, 'GET', `/v1/trips/${trip.id}/export?format=pdf`)).json;
      const exportedIds = new Set([...exported.expenses, ...exported.voidedExpenses].map((e: { id: string }) => e.id));
      expect([...exportedIds].sort(), `${u.name} export`).toEqual([...visible].sort());

      const inbox = (await db.query(`users/${u.uid}/notifications`)).map((d) => d.data);
      for (const n of inbox) {
        const entity = n['entity'] as { kind: string; id: string };
        if (entity.kind === 'expense') expect(visible.has(entity.id), `${u.name} notified about ${entity.id}`).toBe(true);
      }
      for (const text of hiddenTexts) {
        expect(JSON.stringify(exported), `${u.name} export leaks «${text}»`).not.toContain(text);
        expect(JSON.stringify(inbox), `${u.name} inbox leaks «${text}»`).not.toContain(text);
      }
    }
  });
});
