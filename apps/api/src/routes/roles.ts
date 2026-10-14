import { SetRoleBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { setMemberRole } from '../services/roles.js';

export function roleRoutes(app: Hono<AppEnv>): void {
  app.put('/v1/trips/:tripId/members/:uid/role', async (c) => {
    const body = parseWith(SetRoleBody, await readJson(c.req.raw));
    return c.json(await setMemberRole(c.get('db'), c.req.param('tripId'), c.req.param('uid'), body, mutationContext(c)));
  });
}
