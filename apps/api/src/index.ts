import { EngineError } from 'finance-engine';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { InvalidTokenError, verifyIdToken } from './auth/verifyIdToken.js';
import { isEmulator } from './env.js';
import { Firestore, FirestoreError } from './firestore/client.js';
import type { LocalStorageProvider } from './providers/localStorage.js';
import { createStorageProvider } from './providers/storage.js';
import type { AppEnv } from './http/context.js';
import { AppError } from './http/errors.js';
import { assertSafeId } from './http/ids.js';
import { log } from './http/log.js';
import { rateLimit } from './http/rateLimit.js';
import { requestLog } from './http/requestLog.js';
import { registerRoutes } from './routes/index.js';
import { resumeDeletions } from './services/accountDeletion.js';
import { runRetention } from './services/retention.js';
import type { Env } from './env.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const incoming = c.req.header('x-correlation-id');
  const correlationId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('correlationId', correlationId);
  await next();
  c.header('x-correlation-id', correlationId);
  // Feature 006: API responses are never cached nor sniffed.
  c.header('x-content-type-options', 'nosniff');
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
});

app.use('*', requestLog);

// Feature 006 (FR-027): public routes are limited per network address before any work.
// The emulator (local dev, tests, E2E) never limits: suites legitimately send bursts.
const clientIp = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('cf-connecting-ip') ?? 'unknown';
const ipLimiter = (c: { env: Env }) => (isEmulator(c.env) ? undefined : c.env.IP_LIMITER);
app.use('/v1/health', rateLimit(ipLimiter, clientIp));
app.use('/local-blobs/*', rateLimit(ipLimiter, clientIp));

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

/** Feature 006 (FR-022): public health check; `?deep=1` also reads Firestore (1 read). */
app.get('/v1/health', async (c) => {
  const base = { version: c.env.API_VERSION || 'dev', environment: c.env.ENVIRONMENT };
  if (c.req.query('deep') !== '1') return c.json({ ok: true, ...base });
  try {
    await new Firestore(c.env).get('ops/health');
    return c.json({ ok: true, ...base, firestore: 'ok' });
  } catch {
    return c.json({ ok: false, ...base, firestore: 'error' }, 503);
  }
});

// Emulator-only local blob store (stands in for presigned B2 URLs in development and tests).
app.on(['GET', 'PUT'], '/local-blobs/:token', async (c) => {
  if (!isEmulator(c.env) || c.env.STORAGE !== 'local') throw new AppError('NOT_FOUND', 'Route not found');
  const storage = createStorageProvider(c.env) as LocalStorageProvider;
  const res = await storage.serve(c.req.param('token'), c.req.raw);
  const origin = c.req.header('origin');
  if (origin && (c.env.ALLOWED_ORIGINS ?? '').split(',').includes(origin)) res.headers.set('access-control-allow-origin', origin);
  return res;
});

// Emulator-only: force the retention job with a chosen "now" (tests and the quickstart walkthrough).
app.post('/local-admin/run-retention', async (c) => {
  if (!isEmulator(c.env)) throw new AppError('NOT_FOUND', 'Route not found');
  const now = c.req.query('now') ? new Date(c.req.query('now')!) : new Date();
  if (Number.isNaN(now.getTime())) throw new AppError('VALIDATION_FAILED', 'Invalid now');
  return c.json(await runRetention(new Firestore(c.env), createStorageProvider(c.env), now));
});

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

app.use('/v1/*', rateLimit((c) => (isEmulator(c.env) ? undefined : c.env.USER_LIMITER), (c) => c.get('user').uid));

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
  } else if (err instanceof FirestoreError && err.status === 'RESOURCE_EXHAUSTED') {
    // Feature 006 (FR-031): the free daily quota is exhausted; it resets within the day.
    log('warn', 'quota_exhausted', { correlationId, service: 'firestore' });
    appError = new AppError('SERVICE_UNAVAILABLE', 'Service temporarily unavailable', { retryAfter: 3600 });
  } else {
    log('error', 'unhandled_error', { correlationId, name: err.name, message: err.message });
    appError = new AppError('INTERNAL', 'Unexpected error');
  }
  c.set('errorCode', appError.code);
  if (appError.retryAfter) c.header('retry-after', String(appError.retryAfter));
  c.header('x-correlation-id', correlationId);
  return c.json(appError.toBody(), appError.status as 400);
});

export { app };

export default {
  fetch: app.fetch,
  /** Hourly Cron Trigger (wrangler.jsonc): receipt retention and orphan upload cleanup. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = new Firestore(env);
    const storage = createStorageProvider(env);
    ctx.waitUntil(
      runRetention(db, storage, new Date())
        // Feature 006 (FR-010): finish account deletions interrupted by a failure.
        .then(() => resumeDeletions(db, storage, env, new Date()))
        .then(() => undefined),
    );
  },
} satisfies ExportedHandler<Env>;
