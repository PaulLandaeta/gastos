import { AwsClient } from 'aws4fetch';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/** Where backups live: a local directory (tests, manual copies) or a private B2 bucket. */
export interface BackupStore {
  readonly description: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export class DirStore implements BackupStore {
  readonly description: string;
  constructor(private readonly root: string) {
    this.description = `directory ${root}`;
  }
  async put(key: string, body: Buffer, _contentType?: string) {
    await mkdir(dirname(join(this.root, key)), { recursive: true });
    await writeFile(join(this.root, key), body);
  }
  async get(key: string) {
    try {
      return await readFile(join(this.root, key));
    } catch {
      return null;
    }
  }
  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(relative(this.root, full).split('\\').join('/'));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
  async delete(key: string) {
    await rm(join(this.root, key), { force: true });
  }
}

export interface B2StoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
}

/** Backblaze B2 through its S3 API (SigV4), a bucket separate from the receipts one. */
export class B2Store implements BackupStore {
  readonly description: string;
  private readonly client: AwsClient;
  constructor(private readonly cfg: B2StoreConfig) {
    this.description = `B2 bucket ${cfg.bucket}`;
    this.client = new AwsClient({ accessKeyId: cfg.keyId, secretAccessKey: cfg.applicationKey, service: 's3', region: cfg.region });
  }
  private url(key = '') {
    return `${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  async put(key: string, body: Buffer, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': contentType } });
    if (!res.ok) throw new Error(`B2 PUT failed: ${res.status}`);
  }
  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`B2 GET failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | null = null;
    do {
      const u = new URL(this.url());
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      if (token) u.searchParams.set('continuation-token', token);
      const res = await this.client.fetch(u.toString());
      if (!res.ok) throw new Error(`B2 LIST failed: ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]!.replace(/&amp;/g, '&'));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? null) : null;
    } while (token);
    return keys.sort();
  }
  async delete(key: string) {
    const res = await this.client.fetch(this.url(key), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`B2 DELETE failed: ${res.status}`);
  }
}

export function storeFromEnv(vars: NodeJS.ProcessEnv = process.env): BackupStore {
  if (vars['BACKUP_DIR']) return new DirStore(vars['BACKUP_DIR']);
  const need = ['BACKUP_B2_ENDPOINT', 'BACKUP_B2_REGION', 'BACKUP_B2_BUCKET', 'BACKUP_B2_KEY_ID', 'BACKUP_B2_APPLICATION_KEY'];
  const missing = need.filter((k) => !vars[k]);
  if (missing.length) throw new Error(`Backup destination not configured: set BACKUP_DIR or ${missing.join(', ')}`);
  return new B2Store({
    endpoint: vars['BACKUP_B2_ENDPOINT']!,
    region: vars['BACKUP_B2_REGION']!,
    bucket: vars['BACKUP_B2_BUCKET']!,
    keyId: vars['BACKUP_B2_KEY_ID']!,
    applicationKey: vars['BACKUP_B2_APPLICATION_KEY']!,
  });
}
