import type { Firestore } from '../firestore/client.js';
import { forbidden, notFound } from '../http/errors.js';
import { writeAudit } from './audit.js';
import {
  assertMutable,
  assertVersion,
  creatorName,
  loadTripForMember,
  requireRole,
  syncIndexes,
  toMemberDto,
  toTripDto,
  writeTrip,
  type MemberData,
  type MutationContext,
} from './tripRepo.js';

/** Only the creator promotes/demotes admins; the creator role itself never changes (RF-34, RF-35). */
export async function setMemberRole(
  db: Firestore,
  tripId: string,
  targetUid: string,
  body: { expectedVersion: number; role: 'admin' | 'member' },
  ctx: MutationContext,
) {
  return db.runTransaction(async (tx) => {
    const { trip, members, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    requireRole(me, ['creator']);
    const target = members.find((m) => m.key === targetUid && m.data.invitationStatus === 'accepted');
    if (!target) throw notFound('Member');
    if (target.data.role === 'creator') throw forbidden('The creator role is permanent');
    assertMutable(trip);
    assertVersion(trip, body.expectedVersion);

    const updated: MemberData = { ...target.data, role: body.role, version: target.data.version + 1 };
    tx.set(`trips/${tripId}/members/${target.key}`, { ...updated }, { updateTime: target.updateTime });
    const next = writeTrip(tx, trip, {}, ctx.now);
    const all = members.map((m) => (m.key === target.key ? { ...m, data: updated } : m));
    syncIndexes(tx, tripId, next, all.map((m) => m.data), ctx.now, creatorName(members));
    writeAudit(
      tx,
      {
        tripId,
        actorUid: ctx.actorUid,
        action: 'member.role.set',
        entityType: 'member',
        entityId: target.key,
        beforeVersion: trip.data.version,
        afterVersion: next.version,
        correlationId: ctx.correlationId,
        diff: { from: target.data.role, to: body.role },
      },
      ctx.now,
    );
    return { trip: toTripDto(tripId, next), member: toMemberDto({ key: target.key, data: updated, updateTime: '' }) };
  });
}
