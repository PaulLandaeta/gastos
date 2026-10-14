import { TripStatusBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { changeTripStatus } from '../services/tripStatus.js';

export function statusRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips/:tripId/status', async (c) => {
    const body = parseWith(TripStatusBody, await readJson(c.req.raw));
    return c.json(await changeTripStatus(c.get('db'), c.req.param('tripId'), body, mutationContext(c)));
  });
}
