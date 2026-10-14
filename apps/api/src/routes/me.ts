import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { syncProfile } from '../services/users.js';

export function meRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/me/sync', async (c) => {
    const user = await syncProfile(c.get('db'), c.get('user'));
    return c.json({ user });
  });
}
