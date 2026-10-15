import { describe, expect, it } from 'vitest';
import { errorText } from '../../src/components/ErrorMessage';
import { ApiError } from '../../src/lib/apiError';

describe('error messages (feature 006)', () => {
  it('explains rate limits and exhausted quotas with the waiting time', () => {
    expect(errorText(new ApiError('RATE_LIMITED', 429, 'x', { retryAfter: 60 }))).toBe(
      'Demasiadas solicitudes seguidas. Espera 60 s e inténtalo de nuevo.',
    );
    expect(errorText(new ApiError('SERVICE_UNAVAILABLE', 503, 'x', { retryAfter: 3600 }))).toBe(
      'El servicio no está disponible temporalmente. Lo que estabas haciendo no se ha perdido; inténtalo más tarde.',
    );
    expect(errorText(new ApiError('ACCOUNT_DELETION_BLOCKED', 409, 'x'))).toMatch(/pagos pendientes/);
    expect(errorText(new ApiError('ACCOUNT_DELETED', 403, 'x'))).toMatch(/eliminada/);
  });
});
