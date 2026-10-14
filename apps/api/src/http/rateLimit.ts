import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from './errors.js';

export const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Feature 006 (FR-027, research R8): Workers rate limiting binding. Limits are per Cloudflare
 * location and approximate, enough to stop bursts. Without a binding (emulator, tests) it is a
 * no-op; AI operations keep their own quotas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rateLimit<C extends Context<any>>(
  getLimiter: (c: C) => Pick<RateLimit, 'limit'> | undefined,
  keyOf: (c: C) => string,
): MiddlewareHandler {
  return async (c, next) => {
    const limiter = getLimiter(c as C);
    if (limiter) {
      const { success } = await limiter.limit({ key: keyOf(c as C) });
      if (!success) {
        throw new AppError('RATE_LIMITED', 'Too many requests', { retryAfter: RATE_LIMIT_WINDOW_SECONDS });
      }
    }
    await next();
  };
}
