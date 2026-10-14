import { ExpectedVersionQuery, InviteBody } from 'contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { mutationContext } from '../http/mutation.js';
import { parseWith, readJson } from '../http/validate.js';
import { acceptInvitation, declineInvitation, inviteMembers, removeInvitee } from '../services/invitations.js';

export function invitationRoutes(app: Hono<AppEnv>): void {
  app.post('/v1/trips/:tripId/invitations/accept', async (c) => {
    return c.json(await acceptInvitation(c.get('db'), c.req.param('tripId'), c.get('user'), mutationContext(c)));
  });

  app.post('/v1/trips/:tripId/invitations/decline', async (c) => {
    return c.json(await declineInvitation(c.get('db'), c.req.param('tripId'), c.get('user'), mutationContext(c)));
  });

  app.post('/v1/trips/:tripId/invitations', async (c) => {
    const body = parseWith(InviteBody, await readJson(c.req.raw));
    return c.json(await inviteMembers(c.get('db'), c.req.param('tripId'), body, mutationContext(c)), 201);
  });

  app.delete('/v1/trips/:tripId/invitations/:memberKey', async (c) => {
    const { expectedVersion } = parseWith(ExpectedVersionQuery, c.req.query());
    return c.json(
      await removeInvitee(c.get('db'), c.req.param('tripId'), c.req.param('memberKey'), expectedVersion, mutationContext(c)),
    );
  });
}
