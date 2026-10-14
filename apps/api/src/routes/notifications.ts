import { NotificationsReadBody, NotificationsUnreadBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { parseWith, readJson } from '../http/validate.js';
import { markNotifications } from '../services/notifications.js';

/** Feature 005 (RF-18): read state of the caller's in-app notifications. Reading is via Firestore. */
export function notificationRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/me/notifications/read', async (c) => {
    const body = parseWith(NotificationsReadBody, await readJson(c.req.raw));
    return c.json(await markNotifications(c.get('db'), c.get('user').uid, body, true, new Date()));
  });
  app.post('/v1/me/notifications/unread', async (c) => {
    const body = parseWith(NotificationsUnreadBody, await readJson(c.req.raw));
    return c.json(await markNotifications(c.get('db'), c.get('user').uid, body, false, new Date()));
  });
}
