import { ERROR_HTTP_STATUS, type ErrorBody, type ErrorCode } from 'contracts';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  /** Seconds to wait before retrying (RATE_LIMITED, SERVICE_UNAVAILABLE). */
  get retryAfter(): number | null {
    const v = this.details?.['retryAfter'];
    return typeof v === 'number' ? v : null;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'Not allowed') => new AppError('FORBIDDEN', message);
