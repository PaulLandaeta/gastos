import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { getStats } from '../services/stats.js';

export function statsRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/trips/:tripId/stats', async (c) => c.json(await getStats(c.get('db'), c.req.param('tripId'), c.get('user').uid)));
}
