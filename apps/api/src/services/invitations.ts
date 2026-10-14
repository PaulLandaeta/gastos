import { MAX_TRIP_MEMBERS, SCHEMA_VERSION, normalizeEmail } from 'contracts';
import type { AuthUser } from '../auth/verifyIdToken.js';
import type { Firestore } from '../firestore/client.js';
import { AppError, notFound } from '../http/errors.js';
import { assertNotDeleted } from './accountDeletion.js';
import { writeAudit } from './audit.js';
import { actorName, notificationsFor, registeredUidsByEmail, writeNotifications } from './notifications.js';
import { newInvitee } from './trips.js';
import {
  assertMutable,
  assertVersion,
  creatorName,
  invitationKey,
  loadTripForMember,
  loadTripRaw,
  requireRole,
  syncIndexes,
  toMemberDto,
  toTripDto,
  tripRefOf,
  writeTrip,
  type MemberData,
  type MemberRecord,
  type MutationContext,
  type TripRecord,
} from './tripRepo.js';

/** Invitations can only change before the first expense (RF-20). */
function assertParticipantsOpen(trip: TripRecord): void {
  if (trip.data.participantsLocked) {
    throw new AppError('PARTICIPANTS_LOCKED', 'Participants are locked after the first expense (RF-20)');
  }
}

export async function inviteMembers(
  db: Firestore,
  tripId: string,
  body: { expectedVersion: number; emails: string[] },
  ctx: MutationContext,
) {
  const keys = await Promise.all(body.emails.map((e) => invitationKey(e)));
  return db.runTransaction(async (tx) => {
    const { trip, members, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    requireRole(me, ['creator']);
    assertMutable(trip);
    assertParticipantsOpen(trip);
    assertVersion(trip, body.expectedVersion);

    const existing = new Set(members.map((m) => m.data.email));
    if (new Set(body.emails).size !== body.emails.length || body.emails.some((e) => existing.has(e))) {
      throw new AppError('DUPLICATE_INVITATION', 'Already invited or already a participant');
    }
    if (members.length + body.emails.length > MAX_TRIP_MEMBERS) {
      throw new AppError('VALIDATION_FAILED', `A trip has at most ${MAX_TRIP_MEMBERS} participants`);
    }

    const added: MemberRecord[] = body.emails.map((email, i) => ({
      key: keys[i]!,
      data: newInvitee(email, ctx.now),
      updateTime: '',
    }));
    for (const row of added) tx.set(`trips/${tripId}/members/${row.key}`, { ...row.data }, { exists: false });

    const next = writeTrip(
      tx,
      trip,
      { pendingInvitationCount: trip.data.pendingInvitationCount + added.length },
      ctx.now,
    );
    const all = [...members, ...added];
    syncIndexes(tx, tripId, next, all.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'member.invite',
        entityType: 'invitation',
        entityId: tripId,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
        diff: { emails: body.emails },
      },
      ctx.now,
    );
    writeNotifications(
      tx,
      notificationsFor({
        kind: 'invitation.received',
        trip: tripRefOf(trip),
        actor: { uid: ctx.actorUid, name: actorName(members, ctx.actorUid) },
        inviteeUids: await registeredUidsByEmail(tx, body.emails),
      }),
      ctx.now,
    );
    return { trip: toTripDto(tripId, next), members: all.map(toMemberDto) };
  });
}

export async function removeInvitee(
  db: Firestore,
  tripId: string,
  memberKey: string,
  expectedVersion: number,
  ctx: MutationContext,
) {
  return db.runTransaction(async (tx) => {
    const { trip, members, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    requireRole(me, ['creator']);
    assertMutable(trip);
    const row = members.find((m) => m.key === memberKey);
    if (!row) throw notFound('Invitation');
    if (row.data.invitationStatus === 'accepted') {
      throw new AppError('MEMBER_ALREADY_ACCEPTED', 'Accepted participants cannot be removed (FR-022)');
    }
    assertParticipantsOpen(trip);
    assertVersion(trip, expectedVersion);

    tx.delete(`trips/${tripId}/members/${row.key}`, { exists: true });
    tx.delete(`invitations/${row.data.email}/trips/${tripId}`);
    const wasDeclined = row.data.invitationStatus === 'declined';
    const next = writeTrip(
      tx,
      trip,
      wasDeclined
        ? { declinedInvitationCount: trip.data.declinedInvitationCount - 1 }
        : { pendingInvitationCount: trip.data.pendingInvitationCount - 1 },
      ctx.now,
    );
    const remaining = members.filter((m) => m.key !== row.key);
    syncIndexes(tx, tripId, next, remaining.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'member.remove_invitation',
        entityType: 'invitation',
        entityId: row.key,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
        diff: { email: row.data.email, status: row.data.invitationStatus },
      },
      ctx.now,
    );
    return { trip: toTripDto(tripId, next) };
  });
}

/** Finds the caller's invitation row; verified e-mail must match (FR-019). */
async function findOwnInvitation(user: AuthUser, members: MemberRecord[]) {
  if (!user.emailVerified || !user.email) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'A verified e-mail is required to answer invitations');
  }
  const email = normalizeEmail(user.email);
  const key = await invitationKey(email);
  const row = members.find((m) => m.key === key && m.data.email === email);
  if (!row) throw notFound('Invitation');
  return row;
}

export async function acceptInvitation(db: Firestore, tripId: string, user: AuthUser, ctx: MutationContext) {
  if (!user.emailVerified || !user.email) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'A verified e-mail is required to answer invitations');
  }
  return db.runTransaction(async (tx) => {
    await assertNotDeleted(tx, user.uid);
    const loaded = await loadTripRaw(tx, tripId);
    if (!loaded) throw notFound('Trip');
    const { trip, members } = loaded;
    const row = await findOwnInvitation(user, members);
    if (row.data.invitationStatus !== 'invited') {
      throw new AppError('INVALID_TRANSITION', 'The invitation was already declined');
    }
    assertMutable(trip);
    if (members.some((m) => m.key === user.uid)) {
      throw new AppError('DUPLICATE_INVITATION', 'Already a participant of this trip');
    }

    const joinOrder = Math.max(...members.map((m) => m.data.joinOrder ?? -1)) + 1;
    const member: MemberData = {
      ...row.data,
      uid: user.uid,
      displayName: user.name ?? row.data.email,
      invitationStatus: 'accepted',
      acceptedAt: ctx.now,
      joinOrder,
      schemaVersion: SCHEMA_VERSION,
      version: row.data.version + 1,
    };
    tx.delete(`trips/${tripId}/members/${row.key}`, { exists: true });
    tx.set(`trips/${tripId}/members/${user.uid}`, { ...member }, { exists: false });
    tx.delete(`invitations/${row.data.email}/trips/${tripId}`);

    const next = writeTrip(
      tx,
      trip,
      {
        memberCount: trip.data.memberCount + 1,
        pendingInvitationCount: trip.data.pendingInvitationCount - 1,
      },
      ctx.now,
    );
    const updated = [...members.filter((m) => m.key !== row.key), { key: user.uid, data: member, updateTime: '' }];
    syncIndexes(tx, tripId, next, updated.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: user.uid,
        action: 'member.accept',
        entityType: 'member',
        entityId: user.uid,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
      },
      ctx.now,
    );
    return { trip: toTripDto(tripId, next), member: toMemberDto({ key: user.uid, data: member, updateTime: '' }) };
  });
}

export async function declineInvitation(db: Firestore, tripId: string, user: AuthUser, ctx: MutationContext) {
  if (!user.emailVerified || !user.email) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'A verified e-mail is required to answer invitations');
  }
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripRaw(tx, tripId);
    if (!loaded) throw notFound('Trip');
    const { trip, members } = loaded;
    const row = await findOwnInvitation(user, members);
    if (row.data.invitationStatus !== 'invited') {
      throw new AppError('INVALID_TRANSITION', 'The invitation was already declined');
    }
    assertMutable(trip);

    const declined: MemberData = { ...row.data, invitationStatus: 'declined', version: row.data.version + 1 };
    tx.set(`trips/${tripId}/members/${row.key}`, { ...declined }, { updateTime: row.updateTime });
    const next = writeTrip(
      tx,
      trip,
      {
        pendingInvitationCount: trip.data.pendingInvitationCount - 1,
        declinedInvitationCount: trip.data.declinedInvitationCount + 1,
      },
      ctx.now,
    );
    const updated = members.map((m) => (m.key === row.key ? { ...m, data: declined } : m));
    syncIndexes(tx, tripId, next, updated.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: user.uid,
        action: 'member.decline',
        entityType: 'invitation',
        entityId: row.key,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
      },
      ctx.now,
    );
    return {};
  });
}
