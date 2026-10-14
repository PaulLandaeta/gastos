/** Stable domain error codes shared by API and web (contracts/http-api.md). */
export const ERROR_HTTP_STATUS = {
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  NOT_RECONCILED: 422,
  INVALID_ALLOCATION: 422,
  INVALID_PERCENT: 422,
  ITEM_WITHOUT_BENEFICIARY: 422,
  PAYER_NOT_MEMBER: 422,
  DISCOUNT_EXCEEDS_ITEM: 422,
  AMOUNT_NOT_SAFE_INTEGER: 422,
  TRIP_NOT_READY: 409,
  TRIP_READ_ONLY: 409,
  PARTICIPANTS_LOCKED: 409,
  CURRENCY_LOCKED: 409,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  DUPLICATE_INVITATION: 409,
  MEMBER_ALREADY_ACCEPTED: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_HTTP_STATUS;
}
