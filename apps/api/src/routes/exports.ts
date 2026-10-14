import { ExportQuery } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith } from '../http/validate.js';
import { exportPage } from '../services/exports.js';

/** Feature 005 (RF-19): privacy-filtered export pages; the browser builds the file. */
export function exportRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/trips/:tripId/export', async (c) => {
    const { format, cursor } = parseWith(ExportQuery, c.req.query());
    const page = await exportPage(c.get('db'), c.req.param('tripId'), format, cursor, mutationContext(c));
    c.header('cache-control', 'no-store');
    return c.json(page);
  });
}
