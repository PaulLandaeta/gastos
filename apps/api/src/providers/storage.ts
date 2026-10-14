import type { ReceiptStorageProvider } from 'contracts';
import { isEmulator, type Env } from '../env.js';
import { B2StorageProvider } from './b2.js';
import { LocalStorageProvider } from './localStorage.js';

export function createStorageProvider(env: Env): ReceiptStorageProvider {
  if (env.STORAGE === 'local') {
    if (!isEmulator(env) || !env.LOCAL_BLOBS || !env.LOCAL_BLOB_SECRET) throw new Error('Local storage is emulator-only');
    return new LocalStorageProvider(env.LOCAL_BLOBS, env.LOCAL_BLOB_SECRET, env.PUBLIC_API_URL ?? 'http://localhost:8787');
  }
  if (!env.B2_BUCKET || !env.B2_ENDPOINT || !env.B2_REGION || !env.B2_KEY_ID || !env.B2_APPLICATION_KEY) {
    throw new Error('Backblaze B2 is not configured');
  }
  return new B2StorageProvider({ bucket: env.B2_BUCKET, endpoint: env.B2_ENDPOINT, region: env.B2_REGION, keyId: env.B2_KEY_ID, applicationKey: env.B2_APPLICATION_KEY });
}
