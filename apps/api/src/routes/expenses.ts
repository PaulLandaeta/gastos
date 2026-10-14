import { CreateExpenseBody, IdempotencyKey, PreviewBody, RestoreExpenseBody, UpdateExpenseBody, VoidExpenseBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { assertSafeId } from '../http/ids.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { checkDuplicates } from '../services/duplicates.js';
import { createExpense, restoreExpense, updateExpense, voidExpense } from '../services/expenses.js';
import { getExpenseHistory } from '../services/history.js';
import { maxRefundableOf } from '../services/refunds.js';
import { assertPreviewAcknowledged, previewExpenseChange, refundEffectsOf, refundProjectionsOf } from '../services/preview.js';

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
    const { expectedVersion, expectedLedgerRevision } = parseWith(VoidExpenseBody, await readJson(c.req.raw));
    const tripId = c.req.param('tripId');
    const expenseId = assertSafeId(c.req.param('expenseId'));
    return c.json(
      await voidExpense(c.get('db'), tripId, expenseId, expectedVersion, mutationContext(c), {
        assertPreview: assertPreviewAcknowledged,
        expectedLedgerRevision,
        refundEffects: (tx) => refundEffectsOf(tx, tripId, expenseId),
        refundProjections: (tx, e) => refundProjectionsOf(tx, tripId, expenseId, e),
      }),
    );
  });

  app.get('/v1/trips/:tripId/expenses/:expenseId/history', async (c) => {
    return c.json(
      await getExpenseHistory(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('expenseId')), c.get('user').uid),
    );
  });

  app.put('/v1/trips/:tripId/expenses/:expenseId', async (c) => {
    const body = parseWith(UpdateExpenseBody, await readJson(c.req.raw));
    return c.json(
      await updateExpense(
        c.get('db'),
        c.req.param('tripId'),
        assertSafeId(c.req.param('expenseId')),
        body,
        mutationContext(c),
        {
          assertPreview: assertPreviewAcknowledged,
          refundProjections: (tx, e) => refundProjectionsOf(tx, c.req.param('tripId'), c.req.param('expenseId'), e),
        },
        maxRefundableOf,
      ),
    );
  });

  app.post('/v1/trips/:tripId/expenses/:expenseId/preview', async (c) => {
    const body = parseWith(PreviewBody, await readJson(c.req.raw));
    return c.json(
      await previewExpenseChange(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('expenseId')), c.get('user').uid, body),
    );
  });

  app.post('/v1/trips/:tripId/expenses/:expenseId/restore', async (c) => {
    const body = parseWith(RestoreExpenseBody, await readJson(c.req.raw));
    const tripId = c.req.param('tripId');
    const expenseId = assertSafeId(c.req.param('expenseId'));
    return c.json(
      await restoreExpense(c.get('db'), tripId, expenseId, body.expectedVersion, mutationContext(c), {
        assertPreview: assertPreviewAcknowledged,
        expectedLedgerRevision: body.expectedLedgerRevision,
        refundEffects: (tx) => refundEffectsOf(tx, tripId, expenseId),
        refundProjections: (tx, e) => refundProjectionsOf(tx, tripId, expenseId, e),
        checkDuplicates,
        confirmDuplicate: body.confirmDuplicate,
      }),
    );
  });
}
