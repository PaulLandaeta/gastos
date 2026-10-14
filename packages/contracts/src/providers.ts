import type { RawReceiptDraft } from './receipts.js';

/** RF-50: swappable AI provider (Gemini first, OpenAI later). Runs only on the server. */
export interface ReceiptAIProvider {
  readonly name: string;
  readonly model: string;
  extract(input: {
    files: { mimeType: string; data: Uint8Array }[];
    currencyHint: string;
    locale?: string;
  }): Promise<RawReceiptDraft>;
}

/** Constitution VI: swappable private object storage (Backblaze B2 first, Supabase as fallback). */
export interface ReceiptStorageProvider {
  readonly name: string;
  presignPut(key: string, contentType: string, bytes: number): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  presignGet(key: string, ttlSeconds: number, downloadName?: string): Promise<{ url: string; expiresAt: Date }>;
  head(key: string): Promise<{ bytes: number; contentType: string } | null>;
  get(key: string): Promise<Uint8Array | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
}
