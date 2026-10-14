import { CreateCategoryBody, UpdateCategoryBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { assertSafeId } from '../http/ids.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { createCategory, updateCategory } from '../services/categories.js';

export function categoryRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips/:tripId/categories', async (c) => {
    const body = parseWith(CreateCategoryBody, await readJson(c.req.raw));
    return c.json(await createCategory(c.get('db'), c.req.param('tripId'), body, mutationContext(c)), 201);
  });

  app.patch('/v1/trips/:tripId/categories/:categoryId', async (c) => {
    const body = parseWith(UpdateCategoryBody, await readJson(c.req.raw));
    return c.json(
      await updateCategory(c.get('db'), c.req.param('tripId'), assertSafeId(c.req.param('categoryId')), body, mutationContext(c)),
    );
  });
}
