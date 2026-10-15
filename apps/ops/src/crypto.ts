import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/** Backup container (research R6): "GVB1" | iv (12) | tag (16) | AES-256-GCM(gzip(plaintext)). */
const MAGIC = Buffer.from('GVB1');

export function parseKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error('BACKUP_KEY is not set (32 random bytes, base64)');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_KEY must decode to 32 bytes');
  return key;
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(gzipSync(plain, { level: 9 })), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decrypt(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < 32 || !sealed.subarray(0, 4).equals(MAGIC)) throw new Error('Not a backup file (unknown format)');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(4, 16));
  decipher.setAuthTag(sealed.subarray(16, 32));
  return gunzipSync(Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()]));
}
