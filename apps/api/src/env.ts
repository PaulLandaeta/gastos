export interface Env {
  ENVIRONMENT: 'production' | 'staging' | 'emulator' | string;
  FIREBASE_PROJECT_ID: string;
  /** host:port of the Firestore emulator; only honoured when ENVIRONMENT=emulator. */
  FIRESTORE_EMULATOR_HOST?: string;
  /** Comma-separated list of allowed CORS origins. */
  ALLOWED_ORIGINS?: string;
  /** Service-account JSON key (Workers secret). Not used in the emulator. */
  FIREBASE_SERVICE_ACCOUNT?: string;
}

/**
 * Emulator mode (unsigned tokens, local Firestore) requires BOTH the flag and a `demo-*` project:
 * demo projects cannot reach real Firebase resources, so a misconfigured production deploy can
 * never accept unsigned tokens (defense in depth).
 */
export const isEmulator = (env: Pick<Env, 'ENVIRONMENT'> & Partial<Pick<Env, 'FIREBASE_PROJECT_ID'>>) =>
  env.ENVIRONMENT === 'emulator' && (env.FIREBASE_PROJECT_ID ?? '').startsWith('demo-');
