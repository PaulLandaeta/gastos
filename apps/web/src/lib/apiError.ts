import type { ErrorCode } from 'contracts';

/** Error envelope of the API (no Firebase dependency, so models and tests can import it). */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
