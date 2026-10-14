import { MAX_TRIP_MEMBERS, SCHEMA_VERSION, normalizeEmail } from 'contracts';
import type { CreateTripBody, UpdateTripBody } from 'contracts';
import type { z } from 'zod';
import type { AuthUser } from '../auth/verifyIdToken.js';
import type { Firestore } from '../firestore/client.js';
import { AppError, forbidden } from '../http/errors.js';
import { writeAudit } from './audit.js';
import {
  assertMutable,
  assertVersion,
  creatorName,
  invitationIndex,
  invitationKey,
  loadTripForMember,
  newId,
  requireRole,
  syncIndexes,
  toMemberDto,
  toTripDto,
  tripPath,
  userTripIndex,
  writeTrip,
  type MemberData,
  type MutationContext,
  type TripData,
} from './tripRepo.js';

type CreateInput = z.output<typeof CreateTripBody>;
type UpdateInput = z.output<typeof UpdateTripBody>;

export async function createTrip(db: Firestore, user: AuthUser, body: CreateInput, ctx: MutationContext) {
  if (!user.email) throw new AppError('VALIDATION_FAILED', 'The Google account has no e-mail');
  const creatorEmail = normalizeEmail(user.email);
  const invitees = body.inviteEmails;
  if (new Set(invitees).size !== invitees.length || invitees.includes(creatorEmail)) {
    throw new AppError('DUPLICATE_INVITATION', 'Duplicate invitation or self invitation');
  }
  if (invitees.length + 1 > MAX_TRIP_MEMBERS) {
    throw new AppError('VALIDATION_FAILED', `A trip has at most ${MAX_TRIP_MEMBERS} participants`);
  }

  const tripId = newId();
  const { now } = ctx;
  const trip: TripData = {
    name: body.name,
    startDate: body.startDate,
    endDate: body.endDate,
    currency: body.currency,
    status: invitees.length > 0 ? 'pending' : 'active',
    previousStatus: null,
    creatorUid: user.uid,
    participantsLocked: false,
    currencyLocked: false,
    firstExpenseAt: null,
    expenseSeq: 0,
    memberCount: 1,
    pendingInvitationCount: invitees.length,
    declinedInvitationCount: 0,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
  };
  const creatorDisplayName = user.name ?? creatorEmail;
  const creator: MemberData = {
    uid: user.uid,
    email: creatorEmail,
    displayName: creatorDisplayName,
    role: 'creator',
    invitationStatus: 'accepted',
    invitedAt: null,
    acceptedAt: now,
    joinOrder: 0,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
  };
  const inviteeRows = await Promise.all(
    invitees.map(async (email) => ({ key: await invitationKey(email), data: newInvitee(email, now) })),
  );

  await db.runTransaction(async (tx) => {
    tx.set(tripPath(tripId), { ...trip }, { exists: false });
    tx.set(`trips/${tripId}/members/${user.uid}`, { ...creator }, { exists: false });
    for (const row of inviteeRows) {
      tx.set(`trips/${tripId}/members/${row.key}`, { ...row.data }, { exists: false });
      tx.set(`invitations/${row.data.email}/trips/${tripId}`, invitationIndex(tripId, trip, 'invited', creatorDisplayName, now));
    }
    tx.set(`users/${user.uid}/trips/${tripId}`, userTripIndex(tripId, trip, 'creator', now));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: user.uid,
        action: 'trip.create',
        entityType: 'trip',
        entityId: tripId,
        beforeVersion: null,
        afterVersion: 1,
        correlationId: ctx.correlationId,
        diff: { name: trip.name, currency: trip.currency, invitees },
      },
      now,
    );
  });
  return { trip: toTripDto(tripId, trip) };
}

export function newInvitee(email: string, now: Date): MemberData {
  return {
    uid: null,
    email,
    displayName: null,
    role: 'member',
    invitationStatus: 'invited',
    invitedAt: now,
    acceptedAt: null,
    joinOrder: null,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
  };
}

export async function getTrip(db: Firestore, uid: string, tripId: string) {
  return db.runTransaction(async (tx) => {
    const { trip, members } = await loadTripForMember(tx, tripId, uid);
    return { trip: toTripDto(trip.id, trip.data), members: members.map(toMemberDto) };
  });
}

export async function updateTrip(db: Firestore, tripId: string, body: UpdateInput, ctx: MutationContext) {
  return db.runTransaction(async (tx) => {
    const { trip, members, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    requireRole(me, ['creator', 'admin']);
    assertMutable(trip);
    assertVersion(trip, body.expectedVersion);

    const patch: Partial<TripData> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.startDate !== undefined) patch.startDate = body.startDate;
    if (body.endDate !== undefined) patch.endDate = body.endDate;
    if (body.currency !== undefined && body.currency !== trip.data.currency) {
      if (me.data.role !== 'creator') throw forbidden('Only the creator can change the currency');
      if (trip.data.currencyLocked) {
        throw new AppError('CURRENCY_LOCKED', 'The currency is locked after the first expense (RF-55)');
      }
      patch.currency = body.currency;
    }
    const startDate = patch.startDate ?? trip.data.startDate;
    const endDate = patch.endDate ?? trip.data.endDate;
    if (endDate < startDate) {
      throw new AppError('VALIDATION_FAILED', 'Invalid request', {
        fields: { endDate: 'La fecha de fin es anterior al inicio' },
      });
    }

    const next = writeTrip(tx, trip, patch, ctx.now);
    syncIndexes(tx, tripId, next, members.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'trip.update',
        entityType: 'trip',
        entityId: tripId,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
        diff: patch,
      },
      ctx.now,
    );
    return { trip: toTripDto(tripId, next) };
  });
}
