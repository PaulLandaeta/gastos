import { CreateRefundBody, IdempotencyKey, RefundableQuery } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { assertSafeId } from '../http/ids.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { createRefund, getRefundable } from '../services/refunds.js';

export function refundRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/trips/:tripId/expenses/:expenseId/items/:itemId/refundable', async (c) => {
    const { quantity } = parseWith(RefundableQuery, c.req.query());
    return c.json(
      await getRefundable(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('expenseId')), c.req.param('itemId'), quantity, c.get('user').uid),
    );
  });

  app.post('/v1/trips/:tripId/expenses/:expenseId/refunds', async (c) => {
    const key = IdempotencyKey.safeParse(c.req.header('idempotency-key'));
    if (!key.success) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header (UUID v4) is required');
    const body = parseWith(CreateRefundBody, await readJson(c.req.raw));
    return c.json(
      await createRefund(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('expenseId')), body, key.data, mutationContext(c)),
      201,
    );
  });
}
