import { BalancesQuery } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { parseWith } from '../http/validate.js';
import { getBalances } from '../services/balances.js';

export function balanceRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/trips/:tripId/balances', async (c) => {
    const { view } = parseWith(BalancesQuery, c.req.query());
    return c.json(await getBalances(c.get('db'), c.req.param('tripId'), c.get('user').uid, view));
  });
}
