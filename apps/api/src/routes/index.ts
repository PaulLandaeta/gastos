import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { accountRoutes } from './account.js';
import { attachmentRoutes } from './attachments.js';
import { balanceRoutes } from './balances.js';
import { categoryRoutes } from './categories.js';
import { expenseRoutes } from './expenses.js';
import { exportRoutes } from './exports.js';
import { invitationRoutes } from './invitations.js';
import { meRoutes } from './me.js';
import { notificationRoutes } from './notifications.js';
import { refundRoutes } from './refunds.js';
import { roleRoutes } from './roles.js';
import { scanRoutes } from './scans.js';
import { settlementRoutes } from './settlements.js';
import { statsRoutes } from './stats.js';
import { statusRoutes } from './status.js';
import { tripRoutes } from './trips.js';

/** Registers every /v1 route. */
export function registerRoutes(app: Hono<AppEnv>): void {
  meRoutes(app);
  accountRoutes(app);
  notificationRoutes(app);
  tripRoutes(app);
  invitationRoutes(app);
  roleRoutes(app);
  statusRoutes(app);
  expenseRoutes(app);
  exportRoutes(app);
  balanceRoutes(app);
  categoryRoutes(app);
  statsRoutes(app);
  settlementRoutes(app);
  refundRoutes(app);
  attachmentRoutes(app);
  scanRoutes(app);
}
