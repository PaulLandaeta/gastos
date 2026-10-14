import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { AppEnv } from './context.js';
import { log } from './log.js';

/**
 * Feature 006 (FR-024): one structured line per request. The route is the registered pattern
 * (`/v1/trips/:tripId`), never the concrete path, so no ids, names or amounts reach the logs.
 */
export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  await next();
  const status = c.res.status;
  log(status >= 500 ? 'error' : 'info', 'request', {
    correlationId: c.get('correlationId'),
    method: c.req.method,
    route: routePath(c, -1),
    status,
    ...(c.get('errorCode') ? { code: c.get('errorCode') } : {}),
    ms: Date.now() - started,
  });
};
