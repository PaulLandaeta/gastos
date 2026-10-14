import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { balanceRoutes } from './balances.js';
import { expenseRoutes } from './expenses.js';
import { invitationRoutes } from './invitations.js';
import { meRoutes } from './me.js';
import { roleRoutes } from './roles.js';
import { statusRoutes } from './status.js';
import { tripRoutes } from './trips.js';

/** Registers every /v1 route. */
export function registerRoutes(app: Hono<AppEnv>): void {
  meRoutes(app);
  tripRoutes(app);
  invitationRoutes(app);
  roleRoutes(app);
  statusRoutes(app);
  expenseRoutes(app);
  balanceRoutes(app);
}
