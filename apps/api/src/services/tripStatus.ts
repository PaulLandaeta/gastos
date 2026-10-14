import type { Role, TripStatus, TripStatusAction } from 'contracts';
import type { Firestore } from '../firestore/client.js';
import { AppError, forbidden } from '../http/errors.js';
import { writeAudit } from './audit.js';
import {
  assertVersion,
  creatorName,
  loadTripForMember,
  syncIndexes,
  toTripDto,
  writeTrip,
  type MutationContext,
  type TripData,
} from './tripRepo.js';

interface Transition {
  from: TripStatus[];
  roles: Role[];
  to: (trip: TripData) => Partial<TripData>;
}

/** FR-025: allowed transitions and who may trigger them. pending→active is automatic. */
const TRANSITIONS: Record<TripStatusAction, Transition> = {
  close: { from: ['active'], roles: ['creator', 'admin'], to: () => ({ status: 'closed' }) },
  reopen: { from: ['closed'], roles: ['creator', 'admin'], to: () => ({ status: 'active' }) },
  archive: {
    from: ['pending', 'active', 'closed'],
    roles: ['creator'],
    to: (t) => ({ status: 'archived', previousStatus: t.status }),
  },
  restore: {
    from: ['archived'],
    roles: ['creator'],
    to: (t) => ({ status: t.previousStatus ?? 'active', previousStatus: null }),
  },
};

export async function changeTripStatus(
  db: Firestore,
  tripId: string,
  body: { expectedVersion: number; action: TripStatusAction },
  ctx: MutationContext,
) {
  return db.runTransaction(async (tx) => {
    const { trip, members, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    const transition = TRANSITIONS[body.action];
    if (!transition.roles.includes(me.data.role)) throw forbidden(`Your role cannot ${body.action} the trip`);
    if (!transition.from.includes(trip.data.status)) {
      throw new AppError('INVALID_TRANSITION', `Cannot ${body.action} a ${trip.data.status} trip`, {
        status: trip.data.status,
      });
    }
    assertVersion(trip, body.expectedVersion);

    const next = writeTrip(tx, trip, transition.to(trip.data), ctx.now);
    syncIndexes(tx, tripId, next, members.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: `trip.status.${body.action}`,
        entityType: 'trip',
        entityId: tripId,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
        diff: { from: trip.data.status, to: next.status },
      },
      ctx.now,
    );
    return { trip: toTripDto(tripId, next) };
  });
}
