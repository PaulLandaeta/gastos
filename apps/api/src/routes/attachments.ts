import { CreateUploadsBody, LinkUploadsBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { assertSafeId } from '../http/ids.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { createStorageProvider } from '../providers/storage.js';
import { attachToTarget, attachmentUrl, expiringAttachments, listAttachments, removeExpenseAttachment } from '../services/attachments.js';
import { createUploads, type Target } from '../services/uploads.js';

export function attachmentRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips/:tripId/uploads', async (c) => {
    const body = parseWith(CreateUploadsBody, await readJson(c.req.raw));
    return c.json(await createUploads(c.get('db'), createStorageProvider(c.env), c.req.param('tripId'), body, mutationContext(c)), 201);
  });

  app.get('/v1/trips/:tripId/attachments/expiring', async (c) =>
    c.json(await expiringAttachments(c.get('db'), c.req.param('tripId'), c.get('user').uid, new Date())),
  );

  for (const kind of ['expense', 'settlement'] as const) {
    const base = `/v1/trips/:tripId/${kind}s/:targetId/attachments`;
    const targetOf = (id: string | undefined): Target => ({ kind, id: assertSafeId(id) });

    app.get(base, async (c) =>
      c.json(await listAttachments(c.get('db'), c.req.param('tripId')!, targetOf(c.req.param('targetId')), c.get('user').uid)),
    );

    app.post(base, async (c) => {
      const { uploadIds } = parseWith(LinkUploadsBody, await readJson(c.req.raw));
      const target = targetOf(c.req.param('targetId'));
      return c.json(
        await attachToTarget(c.get('db'), createStorageProvider(c.env), c.req.param('tripId')!, target, uploadIds, mutationContext(c)),
        201,
      );
    });

    app.get(`${base}/:attachmentId/url`, async (c) =>
      c.json(
        await attachmentUrl(
          c.get('db'),
          createStorageProvider(c.env),
          c.req.param('tripId')!,
          targetOf(c.req.param('targetId')),
          assertSafeId(c.req.param('attachmentId')),
          c.get('user').uid,
        ),
      ),
    );
  }

  app.delete('/v1/trips/:tripId/expenses/:expenseId/attachments/:attachmentId', async (c) =>
    c.json(
      await removeExpenseAttachment(
        c.get('db'),
        createStorageProvider(c.env),
        c.req.param('tripId'),
        assertSafeId(c.req.param('expenseId')),
        assertSafeId(c.req.param('attachmentId')),
        mutationContext(c),
      ),
    ),
  );
}
