import { currencyDecimals } from './currencies.js';

export type EngineErrorCode =
  | 'NOT_RECONCILED'
  | 'INVALID_ALLOCATION'
  | 'INVALID_PERCENT'
  | 'ITEM_WITHOUT_BENEFICIARY'
  | 'PAYER_NOT_MEMBER'
  | 'DISCOUNT_EXCEEDS_ITEM'
  | 'AMOUNT_NOT_SAFE_INTEGER'
  | 'INVALID_CURRENCY';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: EngineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

/** Decimals of the currency's minor unit (ISO 4217). */
export function minorUnits(currency: string): number {
  const decimals = currencyDecimals(currency);
  if (decimals === undefined) {
    throw new EngineError('INVALID_CURRENCY', `Unknown ISO 4217 currency: ${currency}`);
  }
  return decimals;
}

/** Every persisted or computed amount MUST be a safe integer in minor units (Principle I). */
export function assertSafeMinor(value: number, field = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new EngineError('AMOUNT_NOT_SAFE_INTEGER', `${field} must be a safe integer`, { field });
  }
}

export function assertNonNegativeMinor(value: number, field: string): void {
  assertSafeMinor(value, field);
  if (value < 0) {
    throw new EngineError('INVALID_ALLOCATION', `${field} must not be negative`, { field });
  }
}

/** Converts a bigint back to number, guarding the safe-integer range. */
export function toSafeNumber(value: bigint, field = 'amount'): number {
  const n = Number(value);
  assertSafeMinor(n, field);
  return n;
}
