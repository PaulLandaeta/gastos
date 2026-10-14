import { CreateExpenseBody, IdempotencyKey, VoidExpenseBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { assertSafeId } from '../http/ids.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { checkDuplicates } from '../services/duplicates.js';
import { createExpense, voidExpense } from '../services/expenses.js';
import { getExpenseHistory } from '../services/history.js';

export function expenseRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips/:tripId/expenses', async (c) => {
    const key = IdempotencyKey.safeParse(c.req.header('idempotency-key'));
    if (!key.success) {
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header (UUID v4) is required', {
        fields: { 'Idempotency-Key': 'required' },
      });
    }
    const body = parseWith(CreateExpenseBody, await readJson(c.req.raw));
    const result = await createExpense(c.get('db'), c.req.param('tripId'), body, key.data, mutationContext(c), checkDuplicates);
    return c.json(result, 201);
  });

  app.post('/v1/trips/:tripId/expenses/:expenseId/void', async (c) => {
    const { expectedVersion } = parseWith(VoidExpenseBody, await readJson(c.req.raw));
    return c.json(
      await voidExpense(
        c.get('db'),
        c.req.param('tripId'),
        assertSafeId(c.req.param('expenseId')),
        expectedVersion,
        mutationContext(c),
      ),
    );
  });

  app.get('/v1/trips/:tripId/expenses/:expenseId/history', async (c) => {
    return c.json(
      await getExpenseHistory(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('expenseId')), c.get('user').uid),
    );
  });
}
