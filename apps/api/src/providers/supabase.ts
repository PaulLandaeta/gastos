import type { ReceiptStorageProvider } from 'contracts';

/**
 * Fallback documented in the constitution (Supabase Storage, 1 GB free) if Backblaze B2 required a
 * card. Same interface; to be implemented only if that decision is taken.
 */
export class SupabaseStorageProvider implements ReceiptStorageProvider {
  readonly name = 'supabase';
  private fail(): never {
    throw new Error('SupabaseStorageProvider is not configured (fallback not enabled)');
  }
  presignPut(): never { return this.fail(); }
  presignGet(): never { return this.fail(); }
  head(): never { return this.fail(); }
  get(): never { return this.fail(); }
  delete(): never { return this.fail(); }
}
