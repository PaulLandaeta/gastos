import { CreateSettlementBody, IdempotencyKey, ResolveSettlementBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { assertSafeId } from '../http/ids.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { createSettlement, resolveSettlement } from '../services/settlements.js';

export function settlementRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips/:tripId/settlements', async (c) => {
    const key = IdempotencyKey.safeParse(c.req.header('idempotency-key'));
    if (!key.success) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header (UUID v4) is required');
    const body = parseWith(CreateSettlementBody, await readJson(c.req.raw));
    return c.json(await createSettlement(c.get('db'), c.req.param('tripId'), body, key.data, mutationContext(c)), 201);
  });

  for (const action of ['confirm', 'reject', 'cancel'] as const) {
    app.post(`/v1/trips/:tripId/settlements/:settlementId/${action}`, async (c) => {
      const body = parseWith(ResolveSettlementBody, await readJson(c.req.raw));
      return c.json(
        await resolveSettlement(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('settlementId')), action, body, mutationContext(c)),
      );
    });
  }
}
