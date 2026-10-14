import { env } from 'cloudflare:workers';
import { addCalendarMonths } from 'contracts';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Firestore } from '../../src/firestore/client.js';
import { clearFirestore } from '../helpers/emulator.js';
import { call, users } from '../helpers/http.js';
import { activeTrip, anaOwesPedro, equalExpense, pay, postExpense } from '../helpers/trips.js';
import { fetchSigned, jpeg, pdf, requestUploads, upload } from '../helpers/uploads.js';

const db = new Firestore(env);
const { ana, pedro, juan, luis, eve } = users;

beforeAll(clearFirestore);
afterEach(() => {
  vi.useRealTimers();
});

const attachments = (user: typeof ana, tripId: string, expenseId: string) =>
  call(user, 'GET', `/v1/trips/${tripId}/expenses/${expenseId}/attachments`);
const urlOf = (user: typeof ana, tripId: string, expenseId: string, id: string) =>
  call(user, 'GET', `/v1/trips/${tripId}/expenses/${expenseId}/attachments/${id}/url`);

describe('uploads and expense attachments (US2)', () => {
  it('validates type, size and pages before storing anything (FR-002)', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const bad = [
      { name: 'virus.exe', mimeType: 'application/x-msdownload', data: new Uint8Array([1]) },
      { name: 'big.jpg', mimeType: 'image/jpeg', data: new Uint8Array([1]), bytes: 10 * 1024 * 1024 + 1 },
      { name: 'empty.jpg', mimeType: 'image/jpeg', data: new Uint8Array([1]), bytes: 0 },
      pdf('x', 11),
      { ...jpeg('x'), pages: 2 },
    ];
    for (const f of bad) {
      const res = await requestUploads(ana, trip.id, [f]);
      expect(res.status, f.name).toBe(422);
      expect(res.json.error.code).toBe('ATTACHMENT_INVALID');
    }
    expect(await db.query(`trips/${trip.id}/uploads`)).toHaveLength(0);
  });

  it('PRD «comprobante privado»: images + PDF linked on creation; only viewers get 15-min links', async () => {
    const trip = await activeTrip(ana, [pedro, juan, luis], { name: 'Privado' });
    // Luis becomes admin to check manager access.
    const role = await call(ana, 'PUT', `/v1/trips/${trip.id}/members/${luis.uid}/role`, { body: { role: 'admin', expectedVersion: trip.version } });
    expect(role.status).toBe(200);
    const files = [jpeg('ticket-1'), jpeg('ticket-2', 'b.png'), pdf('%PDF-1.7 three pages', 3)];
    files[1]!.mimeType = 'image/png';
    const uploadIds = await upload(pedro, trip.id, files);

    const before = new Date();
    const created = await postExpense(pedro, trip.id, { ...equalExpense(pedro.uid, [ana.uid, pedro.uid], 3000), attachmentUploadIds: uploadIds });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const expenseId = created.json.expense.id as string;

    const stored = (await db.get(`trips/${trip.id}/expenses/${expenseId}`))!.data;
    expect(stored).toMatchObject({ attachmentCount: 3, source: 'manual', scanId: null });

    const list = await attachments(pedro, trip.id, expenseId);
    expect(list.status).toBe(200);
    expect(list.json.attachments).toHaveLength(3);
    const pdfAtt = list.json.attachments.find((a: { mimeType: string }) => a.mimeType === 'application/pdf');
    expect(pdfAtt).toMatchObject({ fileName: 'factura.pdf', pages: 3, status: 'active', source: 'manual', uploadedBy: pedro.uid });
    const uploadedAt = new Date(pdfAtt.uploadedAt);
    expect(uploadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(pdfAtt.expiresAt).toBe(addCalendarMonths(uploadedAt, 6).toISOString());

    // Uploads are now linked and no longer pending.
    for (const id of uploadIds) expect((await db.get(`trips/${trip.id}/uploads/${id}`))!.data['status']).toBe('linked');

    const link = await urlOf(ana, trip.id, expenseId, pdfAtt.id);
    expect(link.status).toBe(200);
    expect(new Date(link.json.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(900_000);
    const file = await fetchSigned(link.json.url);
    expect(await file.text()).toBe('%PDF-1.7 three pages');
    expect((await urlOf(luis, trip.id, expenseId, pdfAtt.id)).status).toBe(200);

    // Juan is not involved: no list, no link, not even with the id.
    expect((await attachments(juan, trip.id, expenseId)).status).toBe(404);
    expect((await urlOf(juan, trip.id, expenseId, pdfAtt.id)).status).toBe(404);
    expect((await urlOf(eve, trip.id, expenseId, pdfAtt.id)).status).toBe(404);

    // The link stops working after 15 minutes.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    expect((await fetchSigned(link.json.url)).status).toBe(403);
  });

  it('attaches to an existing expense, rejects duplicates by content and foreign uploads', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const expenseId = (await postExpense(ana, trip.id, equalExpense(ana.uid, [ana.uid, pedro.uid]))).json.expense.id as string;
    const [u1] = await upload(pedro, trip.id, [jpeg('same-content')], { expenseId });
    const linked = await call(pedro, 'POST', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments`, { body: { uploadIds: [u1] } });
    expect(linked.status, JSON.stringify(linked.json)).toBe(201);
    expect(linked.json.attachments).toHaveLength(1);

    const again = await requestUploads(ana, trip.id, [jpeg('same-content', 'otro-nombre.jpg')], { expenseId });
    expect(again.status).toBe(409);
    expect(again.json.error).toMatchObject({ code: 'ATTACHMENT_DUPLICATE', details: { existingId: u1 } });

    // Juan cannot see the expense, so he cannot target it either.
    expect((await requestUploads(juan, trip.id, [jpeg('j')], { expenseId })).status).toBe(404);
    // Ana cannot link Pedro's pending upload.
    const [u2] = await upload(pedro, trip.id, [jpeg('other')]);
    const foreign = await call(ana, 'POST', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments`, { body: { uploadIds: [u2] } });
    expect(foreign.status).toBe(422);
    expect(foreign.json.error.code).toBe('ATTACHMENT_INVALID');
    // An upload can be linked only once.
    const twice = await call(pedro, 'POST', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments`, { body: { uploadIds: [u1] } });
    expect(twice.json.error.code).toBe('ATTACHMENT_INVALID');
  });

  it('an object that does not match the declaration is rejected and deleted', async () => {
    const trip = await activeTrip(ana, [pedro]);
    const res = await requestUploads(ana, trip.id, [{ ...jpeg('12345'), bytes: 5 }]);
    const u = res.json.uploads[0];
    // The browser uploads fewer bytes than declared (or nothing at all).
    expect((await fetchSigned(u.uploadUrl, { method: 'PUT', headers: u.headers, body: new Uint8Array([1, 2]) })).status).toBe(200);
    const created = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid]), attachmentUploadIds: [u.id] });
    expect(created.status).toBe(422);
    expect(created.json.error.code).toBe('ATTACHMENT_INVALID');
    expect((await db.get(`trips/${trip.id}/uploads/${u.id}`))!.data['status']).toBe('deleted');
    expect(await env.LOCAL_BLOBS!.head((await db.get(`trips/${trip.id}/uploads/${u.id}`))!.data['storageKey'] as string)).toBeNull();
    // No expense was created.
    expect(await db.query(`trips/${trip.id}/expenses`)).toHaveLength(0);

    const [missing] = (await requestUploads(ana, trip.id, [jpeg('never-put')])).json.uploads.map((x: { id: string }) => x.id);
    const res2 = await postExpense(ana, trip.id, { ...equalExpense(ana.uid, [ana.uid, pedro.uid]), attachmentUploadIds: [missing] });
    expect(res2.json.error.code).toBe('ATTACHMENT_INVALID');
  });

  it('author, creator and admins remove receipts; others cannot; amounts unchanged', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    const ids = await upload(pedro, trip.id, [jpeg('r1'), jpeg('r2'), jpeg('r3')]);
    const created = await postExpense(pedro, trip.id, { ...equalExpense(pedro.uid, [pedro.uid, juan.uid]), attachmentUploadIds: ids });
    const expenseId = created.json.expense.id as string;
    const del = (user: typeof ana, id: string) => call(user, 'DELETE', `/v1/trips/${trip.id}/expenses/${expenseId}/attachments/${id}`);

    expect((await del(juan, ids[0]!)).status).toBe(403); // beneficiary, not author
    expect((await del(pedro, ids[0]!)).status).toBe(200);
    expect((await del(ana, ids[1]!)).status).toBe(200); // creator
    expect((await del(ana, ids[1]!)).json.error.code).toBe('INVALID_TRANSITION');

    const list = (await attachments(pedro, trip.id, expenseId)).json.attachments as { id: string; status: string }[];
    expect(list.filter((a) => a.status === 'active').map((a) => a.id)).toEqual([ids[2]]);
    expect((await urlOf(pedro, trip.id, expenseId, ids[0]!)).status).toBe(404);
    const stored = (await db.get(`trips/${trip.id}/expenses/${expenseId}`))!.data;
    expect(stored).toMatchObject({ attachmentCount: 1, totalMinor: 1000, version: 1 });
    const removed = (await db.get(`trips/${trip.id}/expenses/${expenseId}/attachments/${ids[0]}`))!.data;
    expect(removed['status']).toBe('removed');
    expect(await env.LOCAL_BLOBS!.head(removed['storageKey'] as string)).toBeNull();
    const audit = await db.query(`trips/${trip.id}/auditEvents`, { where: [['action', '==', 'attachment.remove']] });
    expect(audit).toHaveLength(2);
  });

  it('payment proof by the emitter, visible to receiver and managers only (FR-006)', async () => {
    const trip = await activeTrip(ana, [pedro, juan]);
    await anaOwesPedro(trip.id, ana, pedro, 2000);
    const settlementId = (await pay(ana, trip.id, pedro.uid, 1000)).json.settlement.id as string;
    expect((await requestUploads(pedro, trip.id, [jpeg('p')], { settlementId })).status).toBe(403);
    const [u] = await upload(ana, trip.id, [jpeg('transferencia')], { settlementId });
    const base = `/v1/trips/${trip.id}/settlements/${settlementId}/attachments`;
    expect((await call(ana, 'POST', base, { body: { uploadIds: [u] } })).status).toBe(201);

    const list = await call(pedro, 'GET', base);
    expect(list.json.attachments).toHaveLength(1);
    const link = await call(pedro, 'GET', `${base}/${u}/url`);
    expect(await (await fetchSigned(link.json.url)).text()).toBe('transferencia');
    expect((await call(juan, 'GET', base)).status).toBe(404);
    expect((await call(juan, 'GET', `${base}/${u}/url`)).status).toBe(404);
  });
});
