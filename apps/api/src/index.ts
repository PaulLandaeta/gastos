import { EngineError } from 'finance-engine';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { InvalidTokenError, verifyIdToken } from './auth/verifyIdToken.js';
import { Firestore, FirestoreError } from './firestore/client.js';
import type { AppEnv } from './http/context.js';
import { AppError } from './http/errors.js';
import { assertSafeId } from './http/ids.js';
import { log } from './http/log.js';
import { registerRoutes } from './routes/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const incoming = c.req.header('x-correlation-id');
  const correlationId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('correlationId', correlationId);
  await next();
  c.header('x-correlation-id', correlationId);
});

app.use('*', (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['x-correlation-id'],
    maxAge: 600,
  })(c, next),
);

app.get('/v1/health', (c) => c.json({ ok: true }));

app.use('/v1/*', async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
  try {
    c.set('user', await verifyIdToken(match[1]!, c.env));
  } catch (e) {
    if (e instanceof InvalidTokenError) throw new AppError('UNAUTHENTICATED', 'Invalid or expired token');
    throw e;
  }
  c.set('db', new Firestore(c.env));
  await next();
});

app.use('/v1/trips/:tripId/*', async (c, next) => {
  assertSafeId(c.req.param('tripId'));
  await next();
});
app.use('/v1/trips/:tripId', async (c, next) => {
  assertSafeId(c.req.param('tripId'));
  await next();
});

registerRoutes(app);

app.notFound(() => {
  throw new AppError('NOT_FOUND', 'Route not found');
});

app.onError((err, c) => {
  const correlationId = c.get('correlationId');
  let appError: AppError;
  if (err instanceof AppError) appError = err;
  else if (err instanceof EngineError) appError = new AppError(err.code === 'INVALID_CURRENCY' ? 'VALIDATION_FAILED' : err.code, err.message, err.details as Record<string, unknown> | undefined);
  else if (err instanceof FirestoreError && ['FAILED_PRECONDITION', 'ALREADY_EXISTS', 'ABORTED'].includes(err.status)) {
    appError = new AppError('CONFLICT', 'Concurrent modification, please retry');
  } else {
    log('error', 'unhandled_error', { correlationId, name: err.name, message: err.message });
    appError = new AppError('INTERNAL', 'Unexpected error');
  }
  if (appError.status >= 500) c.header('x-correlation-id', correlationId);
  else log('info', 'request_rejected', { correlationId, code: appError.code, path: c.req.path });
  c.header('x-correlation-id', correlationId);
  return c.json(appError.toBody(), appError.status as 400);
});

export default app;
