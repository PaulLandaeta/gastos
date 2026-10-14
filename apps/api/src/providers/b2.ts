import { AwsClient } from 'aws4fetch';
import type { ReceiptStorageProvider } from 'contracts';

export interface B2Config {
  bucket: string;
  endpoint: string;
  region: string;
  keyId: string;
  applicationKey: string;
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/**
 * Backblaze B2 through its S3-compatible API (SigV4 via aws4fetch). Private bucket; the browser
 * uploads and downloads with short-lived presigned URLs, never through the Worker (CPU budget).
 */
export class B2StorageProvider implements ReceiptStorageProvider {
  readonly name = 'b2';
  private readonly client: AwsClient;

  constructor(
    private readonly cfg: B2Config,
    private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  ) {
    this.client = new AwsClient({ accessKeyId: cfg.keyId, secretAccessKey: cfg.applicationKey, service: 's3', region: cfg.region });
  }

  private objectUrl(key: string): URL {
    return new URL(`${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}/${encodeKey(key)}`);
  }

  private async presign(method: string, key: string, ttlSeconds: number, headers: Record<string, string> = {}, query: Record<string, string> = {}) {
    const url = this.objectUrl(key);
    url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const signed = await this.client.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
    return signed.url;
  }

  async presignPut(key: string, contentType: string, _bytes: number) {
    const headers = { 'content-type': contentType };
    return { url: await this.presign('PUT', key, 900, headers), headers, expiresAt: new Date(Date.now() + 900_000) };
  }

  async presignGet(key: string, ttlSeconds: number, downloadName?: string) {
    // Signed response header: the file opens with its original (ASCII-safe) name and is never cached.
    const query: Record<string, string> = { 'response-cache-control': 'private, no-store' };
    if (downloadName) query['response-content-disposition'] = `inline; filename="${downloadName.replace(/[^A-Za-z0-9._ -]/g, '_')}"`;
    return { url: await this.presign('GET', key, ttlSeconds, {}, query), expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  private async send(method: string, key: string) {
    const signed = await this.client.sign(new Request(this.objectUrl(key), { method }));
    return this.fetchImpl(signed);
  }

  async head(key: string) {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`B2 HEAD failed: ${res.status}`);
    return { bytes: Number(res.headers.get('content-length') ?? 0), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async get(key: string) {
    const res = await this.send('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`B2 GET failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string) {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`B2 DELETE failed: ${res.status}`);
  }
}
