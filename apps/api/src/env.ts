export interface Env {
  ENVIRONMENT: 'production' | 'staging' | 'emulator' | string;
  FIREBASE_PROJECT_ID: string;
  /** host:port of the Firestore emulator; only honoured when ENVIRONMENT=emulator. */
  FIRESTORE_EMULATOR_HOST?: string;
  /** Comma-separated list of allowed CORS origins. */
  ALLOWED_ORIGINS?: string;
  /** Service-account JSON key (Workers secret). Not used in the emulator. */
  FIREBASE_SERVICE_ACCOUNT?: string;
  // Feature 004 — AI and attachments
  AI_PROVIDER?: 'gemini' | 'fake' | string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  STORAGE?: 'b2' | 'local' | string;
  B2_BUCKET?: string;
  B2_ENDPOINT?: string;
  B2_REGION?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  /** Emulator only: local blob store (Miniflare R2) and its URL signing secret. */
  LOCAL_BLOBS?: R2Bucket;
  LOCAL_BLOB_SECRET?: string;
  PUBLIC_API_URL?: string;
  AI_QUOTA_TRIP_DAY?: string;
  AI_QUOTA_GLOBAL_DAY?: string;
  AI_QUOTA_GLOBAL_MONTH?: string;
  /** Comma-separated uids allowed to read AI usage metrics. */
  ADMIN_UIDS?: string;
}

/**
 * Emulator mode (unsigned tokens, local Firestore) requires BOTH the flag and a `demo-*` project:
 * demo projects cannot reach real Firebase resources, so a misconfigured production deploy can
 * never accept unsigned tokens (defense in depth).
 */
export const isEmulator = (env: Pick<Env, 'ENVIRONMENT'> & Partial<Pick<Env, 'FIREBASE_PROJECT_ID'>>) =>
  env.ENVIRONMENT === 'emulator' && (env.FIREBASE_PROJECT_ID ?? '').startsWith('demo-');
