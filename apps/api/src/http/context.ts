import type { Context } from 'hono';
import type { AuthUser } from '../auth/verifyIdToken.js';
import type { Env } from '../env.js';
import type { Firestore } from '../firestore/client.js';

export interface AppVariables {
  correlationId: string;
  user: AuthUser;
  db: Firestore;
  /** Domain error code of the response (request log, feature 006). */
  errorCode: string;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
export type AppContext = Context<AppEnv>;
