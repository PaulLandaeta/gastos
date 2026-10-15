import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, parseKey } from '../src/crypto.js';

const key = parseKey(randomBytes(32).toString('base64'));

describe('backup encryption (gzip + AES-256-GCM)', () => {
  it('round-trips and compresses', () => {
    const plain = Buffer.from('{"name":"trips/t1"}\n'.repeat(1000));
    const sealed = encrypt(plain, key);
    expect(sealed.subarray(0, 4).toString()).toBe('GVB1');
    expect(sealed.length).toBeLessThan(plain.length / 5);
    expect(decrypt(sealed, key).equals(plain)).toBe(true);
  });

  it('fails with another key or tampered data', () => {
    const sealed = encrypt(Buffer.from('secret'), key);
    expect(() => decrypt(sealed, parseKey(randomBytes(32).toString('base64')))).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decrypt(tampered, key)).toThrow();
    expect(() => decrypt(Buffer.from('nope'), key)).toThrow(/format/);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => parseKey(undefined)).toThrow(/BACKUP_KEY/);
  });
});
