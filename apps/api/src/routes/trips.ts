import { CreateTripBody, UpdateTripBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { createTrip, getTrip, updateTrip } from '../services/trips.js';

export function tripRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips', async (c) => {
    const body = parseWith(CreateTripBody, await readJson(c.req.raw));
    const result = await createTrip(c.get('db'), c.get('user'), body, mutationContext(c));
    return c.json(result, 201);
  });

  app.get('/v1/trips/:tripId', async (c) => {
    return c.json(await getTrip(c.get('db'), c.get('user').uid, c.req.param('tripId')));
  });

  app.patch('/v1/trips/:tripId', async (c) => {
    const body = parseWith(UpdateTripBody, await readJson(c.req.raw));
    return c.json(await updateTrip(c.get('db'), c.req.param('tripId'), body, mutationContext(c)));
  });
}
