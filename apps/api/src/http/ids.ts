import { AppError } from './errors.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Path parameters become Firestore document ids: only allow safe id characters (no "/" after
 * URL decoding). Anything else is answered as NOT_FOUND without touching the database.
 */
export function assertSafeId(value: string | undefined): string {
  if (!value || !SAFE_ID.test(value)) throw new AppError('NOT_FOUND', 'Route not found');
  return value;
}
