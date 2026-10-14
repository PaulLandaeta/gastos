import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { B2StorageProvider } from '../../src/providers/b2.js';
import { LocalStorageProvider } from '../../src/providers/localStorage.js';

const local = () => new LocalStorageProvider(env.LOCAL_BLOBS!, env.LOCAL_BLOB_SECRET!, env.PUBLIC_API_URL!);

async function viaApp(url: string, init?: RequestInit) {
  const u = new URL(url);
  return app.request(u.pathname + u.search, init, env);
}

describe('LocalStorageProvider (emulator)', () => {
  it('signed PUT then signed GET round-trips the bytes; head and idempotent delete', async () => {
    const s = local();
    const put = await s.presignPut('trips/t1/uploads/u1/ticket.jpg', 'image/jpeg', 5);
    expect(put.headers['content-type']).toBe('image/jpeg');
    const r1 = await viaApp(put.url, { method: 'PUT', headers: put.headers, body: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(r1.status).toBe(200);
    expect(await s.head('trips/t1/uploads/u1/ticket.jpg')).toEqual({ bytes: 5, contentType: 'image/jpeg' });
    const get = await s.presignGet('trips/t1/uploads/u1/ticket.jpg', 900);
    const r2 = await viaApp(get.url);
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    await s.delete('trips/t1/uploads/u1/ticket.jpg');
    await s.delete('trips/t1/uploads/u1/ticket.jpg');
    expect(await s.head('trips/t1/uploads/u1/ticket.jpg')).toBeNull();
  });

  it('rejects forged, expired, wrong-method and oversized uploads', async () => {
    const s = local();
    const put = await s.presignPut('k/a.png', 'image/png', 3);
    const forged = put.url.replace(/\.[^.]+$/, '.AAAA');
    expect((await viaApp(forged, { method: 'PUT', headers: put.headers, body: new Uint8Array([1]) })).status).toBe(403);
    expect((await viaApp(put.url, { method: 'GET' })).status).toBe(403);
    expect((await viaApp(put.url, { method: 'PUT', headers: put.headers, body: new Uint8Array([1, 2, 3, 4]) })).status).toBe(413);
    const expired = await s.presignGet('k/a.png', -1);
    expect((await viaApp(expired.url)).status).toBe(403);
  });
});

describe('B2StorageProvider (SigV4, mocked network)', () => {
  const b2 = (fetchImpl?: typeof fetch) =>
    new B2StorageProvider(
      { bucket: 'gastos', endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', keyId: 'KEYID', applicationKey: 'SECRET' },
      fetchImpl,
    );

  it('presigns private, short-lived PUT and GET URLs scoped to the key', async () => {
    const put = await b2().presignPut('trips/t1/uploads/u1/a b.jpg', 'image/jpeg', 100);
    const u = new URL(put.url);
    expect(u.host).toBe('s3.us-west-004.backblazeb2.com');
    expect(u.pathname).toBe('/gastos/trips/t1/uploads/u1/a%20b.jpg');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(put.headers['content-type']).toBe('image/jpeg');
    const get = await b2().presignGet('trips/t1/uploads/u1/a b.jpg', 900);
    expect(new URL(get.url).searchParams.get('X-Amz-Expires')).toBe('900');
    expect(get.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(900_000);
  });

  it('head/delete map 404 to null/success', async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      calls.push(`${req.method} ${new URL(req.url).pathname}`);
      if (req.method === 'HEAD') return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    };
    expect(await b2(fake).head('x.jpg')).toBeNull();
    await b2(fake).delete('x.jpg');
    expect(calls).toEqual(['HEAD /gastos/x.jpg', 'DELETE /gastos/x.jpg']);
  });
});
