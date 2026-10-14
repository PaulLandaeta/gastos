import { z } from 'zod';
import type { DraftWarning, ReceiptDraft } from '../receipts.js';

/** FR-016: per-analysis limits (checked before the provider is called). */
export const MAX_SCAN_FILES = 5;
export const MAX_SCAN_PAGES = 10;
export const MAX_SCAN_BYTES = 4 * 1024 * 1024;
/** Initial quotas (overridable by env vars or the `config/ai` document). */
export const DEFAULT_AI_QUOTAS = { tripDay: 20, globalDay: 100, globalMonth: 1500, retriesPerFile: 2 } as const;

export const ScanBody = z.object({
  uploadIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(MAX_SCAN_FILES + 5),
});
export type ScanBody = z.input<typeof ScanBody>;

export interface ScanResponse {
  scanId: string;
  draft: ReceiptDraft;
  warnings: DraftWarning[];
  quota: { tripRemainingToday: number };
}

export type QuotaScope = 'trip' | 'global_day' | 'global_month' | 'file';

export interface AiUsageDay {
  date: string;
  requests: number;
  pages: number;
  bytes: number;
  failures: number;
  byProvider: Record<string, number>;
}

export interface AiUsageResponse {
  days: AiUsageDay[];
  trips: { tripId: string; requests: number; pages: number; bytes: number; failures: number }[];
  users: { uid: string; requests: number }[];
}
