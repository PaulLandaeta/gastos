import type { ReceiptStorageProvider } from 'contracts';

interface Grant {
  key: string;
  m: 'PUT' | 'GET';
  ct?: string;
  b?: number;
  exp: number;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

/**
 * Emulator-only storage (Miniflare local R2) with HMAC-signed, expiring URLs that mimic presigned
 * B2 URLs, so the browser flow is identical in development and tests. Never used in production.
 */
export class LocalStorageProvider implements ReceiptStorageProvider {
  readonly name = 'local';

  constructor(
    private readonly bucket: R2Bucket,
    private readonly secret: string,
    private readonly baseUrl: string,
  ) {}

  private async url(grant: Grant): Promise<string> {
    const payload = b64url(enc.encode(JSON.stringify(grant)));
    return `${this.baseUrl}/local-blobs/${payload}.${await hmac(this.secret, payload)}`;
  }

  async presignPut(key: string, contentType: string, bytes: number) {
    const exp = Date.now() + 900_000;
    return { url: await this.url({ key, m: 'PUT', ct: contentType, b: bytes, exp }), headers: { 'content-type': contentType }, expiresAt: new Date(exp) };
  }

  async presignGet(key: string, ttlSeconds: number) {
    const exp = Date.now() + ttlSeconds * 1000;
    return { url: await this.url({ key, m: 'GET', exp }), expiresAt: new Date(exp) };
  }

  async head(key: string) {
    const o = await this.bucket.head(key);
    return o ? { bytes: o.size, contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' } : null;
  }

  async get(key: string) {
    const o = await this.bucket.get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }

  async delete(key: string) {
    await this.bucket.delete(key);
  }

  /** Handles `/local-blobs/{token}` requests (emulator route). */
  async serve(token: string, request: Request): Promise<Response> {
    const [payload = '', sig = ''] = token.split('.');
    if (!payload || sig !== (await hmac(this.secret, payload))) return new Response('forbidden', { status: 403 });
    let grant: Grant;
    try {
      grant = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Grant;
    } catch {
      return new Response('forbidden', { status: 403 });
    }
    if (grant.exp < Date.now() || grant.m !== request.method) return new Response('forbidden', { status: 403 });
    if (grant.m === 'PUT') {
      const body = new Uint8Array(await request.arrayBuffer());
      if (grant.b !== undefined && body.byteLength > grant.b) return new Response('too large', { status: 413 });
      await this.bucket.put(grant.key, body, { httpMetadata: { contentType: request.headers.get('content-type') ?? grant.ct ?? 'application/octet-stream' } });
      return new Response('ok');
    }
    const o = await this.bucket.get(grant.key);
    if (!o) return new Response('not found', { status: 404 });
    return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, no-store' } });
  }
}
