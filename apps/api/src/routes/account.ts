import { DeleteAccountBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { parseWith, readJson } from '../http/validate.js';
import { createStorageProvider } from '../providers/storage.js';
import { deleteAccount, previewDeletion } from '../services/accountDeletion.js';

/** Feature 006 (RF-56): account deletion and anonymization. */
export function accountRoutes(app: Hono<AppEnv>): void {
  app.get('/v1/me/deletion-preview', async (c) => c.json(await previewDeletion(c.get('db'), c.get('user').uid)));

  app.post('/v1/me/deletion', async (c) => {
    parseWith(DeleteAccountBody, await readJson(c.req.raw));
    return c.json(await deleteAccount(c.get('db'), createStorageProvider(c.env), c.env, c.get('user'), new Date()));
  });
}
