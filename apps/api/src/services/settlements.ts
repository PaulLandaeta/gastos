import { SCHEMA_VERSION } from 'contracts';
import { originalDebts, paymentEffect } from 'finance-engine';
import type { Doc, Firestore } from '../firestore/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';
import { writeAudit } from './audit.js';
import { findIdempotent, idempotencyPath, recordIdempotent } from './idempotency.js';
import { applyToLedger, readLedger } from './ledgerRepo.js';
import { actorName, notificationsFor, writeNotifications } from './notifications.js';
import { assertMutable, loadTripForMember, newId, toTripDto, tripRefOf, writeTrip, type LoadedTrip, type MutationContext } from './tripRepo.js';

const settlementPath = (tripId: string, id: string) => `trips/${tripId}/settlements/${id}`;

interface SettlementData {
  fromUid: string;
  toUid: string;
  amountMinor: number;
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  rejectionReason: string | null;
  resolvedBy: string | null;
  version: number;
}

const toDto = (id: string, d: SettlementData) => ({
  id,
  fromUid: d.fromUid,
  toUid: d.toUid,
  amountMinor: d.amountMinor,
  note: d.note,
  status: d.status,
  rejectionReason: d.rejectionReason,
  resolvedBy: d.resolvedBy,
  version: d.version,
});

function acceptedUids(loaded: LoadedTrip): string[] {
  return loaded.members.filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid).map((m) => m.data.uid!);
}

function assertSettlementsAllowed(loaded: LoadedTrip): void {
  assertMutable(loaded.trip);
  if (loaded.trip.data.status === 'pending') {
    throw new AppError('TRIP_NOT_READY', 'Every invitee must accept before settling');
  }
}

/** RF-09: the emitter registers a payment; it stays pending until the receiver resolves it. */
export async function createSettlement(
  db: Firestore,
  tripId: string,
  body: { toUid: string; amountMinor: number; note?: string | undefined },
  idempotencyKey: string,
  ctx: MutationContext,
) {
  const idemPath = idempotencyPath(tripId, ctx.actorUid, idempotencyKey);
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertSettlementsAllowed(loaded);
    const previous = await findIdempotent(tx, idemPath);
    if (previous) {
      const doc = await tx.get(settlementPath(tripId, previous.resultRef));
      if (!doc) throw new AppError('CONFLICT', 'Idempotency key refers to a missing payment');
      return { settlement: toDto(doc.id, doc.data as unknown as SettlementData), exceedsDebt: false };
    }
    if (body.toUid === ctx.actorUid || !acceptedUids(loaded).includes(body.toUid)) {
      throw new AppError('VALIDATION_FAILED', 'Invalid request', { fields: { toUid: 'Must be another trip participant' } });
    }
    const ledger = await readLedger(tx, tripId);
    const members = loaded.members
      .filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid)
      .map((m) => ({ uid: m.data.uid!, joinOrder: m.data.joinOrder ?? 0 }));
    const owed = originalDebts(ledger.effect, members).find((t) => t.fromUid === ctx.actorUid && t.toUid === body.toUid)?.amountMinor ?? 0;

    const id = newId();
    const data = {
      fromUid: ctx.actorUid,
      toUid: body.toUid,
      amountMinor: body.amountMinor,
      note: body.note || null,
      status: 'pending' as const,
      rejectionReason: null,
      resolvedBy: null,
      createdAt: ctx.now,
      resolvedAt: null,
      idempotencyKey,
      schemaVersion: SCHEMA_VERSION,
      version: 1,
    };
    tx.set(settlementPath(tripId, id), data, { exists: false });
    recordIdempotent(tx, idemPath, { operation: 'settlement.create', resultRef: id }, ctx.now);
    writeAudit(tx, { tripId, actorUid: ctx.actorUid, action: 'settlement.create', entityType: 'settlement', entityId: id, beforeVersion: null, afterVersion: 1, correlationId: ctx.correlationId, diff: { amountMinor: body.amountMinor } }, ctx.now);
    writeNotifications(
      tx,
      notificationsFor({ kind: 'settlement.pending', trip: tripRefOf(loaded.trip), actor: { uid: ctx.actorUid, name: actorName(loaded.members, ctx.actorUid) }, settlementId: id, fromUid: ctx.actorUid, toUid: body.toUid, amountMinor: body.amountMinor }),
      ctx.now,
    );
    return { settlement: toDto(id, data), exceedsDebt: body.amountMinor > owed };
  });
}

async function loadPending(tx: Parameters<Parameters<Firestore['runTransaction']>[0]>[0], tripId: string, id: string, expectedVersion: number) {
  const doc: Doc | null = await tx.get(settlementPath(tripId, id));
  if (!doc) throw notFound('Payment');
  const data = doc.data as unknown as SettlementData;
  if (data.status !== 'pending') throw new AppError('INVALID_TRANSITION', `The payment is already ${data.status}`);
  if (data.version !== expectedVersion) throw new AppError('CONFLICT', 'The payment changed', { currentVersion: data.version });
  return { doc, data };
}

/** RF-21: only the receiver confirms; only confirmed payments change balances (immutable). */
export async function resolveSettlement(
  db: Firestore,
  tripId: string,
  id: string,
  action: 'confirm' | 'reject' | 'cancel',
  body: { expectedVersion: number; reason?: string | undefined },
  ctx: MutationContext,
) {
  return db.runTransaction(async (tx) => {
    const loaded = await loadTripForMember(tx, tripId, ctx.actorUid);
    assertSettlementsAllowed(loaded);
    const { doc, data } = await loadPending(tx, tripId, id, body.expectedVersion);
    const actorMustBe = action === 'cancel' ? data.fromUid : data.toUid;
    if (ctx.actorUid !== actorMustBe) {
      throw forbidden(action === 'cancel' ? 'Only the emitter can cancel' : 'Only the receiver can resolve this payment');
    }
    const status = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'cancelled';
    const next: SettlementData & Record<string, unknown> = {
      ...(doc.data as unknown as SettlementData),
      status,
      rejectionReason: action === 'reject' ? body.reason || null : null,
      resolvedBy: ctx.actorUid,
      resolvedAt: ctx.now,
      version: data.version + 1,
    };
    tx.set(settlementPath(tripId, id), next, { updateTime: doc.updateTime });

    let trip = loaded.trip.data;
    if (action === 'confirm') {
      const ledger = await readLedger(tx, tripId);
      trip = writeTrip(tx, loaded.trip, { confirmedSettlementCount: (loaded.trip.data.confirmedSettlementCount ?? 0) + 1 }, ctx.now);
      applyToLedger(tx, tripId, ledger, paymentEffect({ fromUid: data.fromUid, toUid: data.toUid, amountMinor: data.amountMinor, status: 'confirmed' }), trip.version);
    }
    writeAudit(tx, { tripId, actorUid: ctx.actorUid, action: `settlement.${action}`, entityType: 'settlement', entityId: id, beforeVersion: data.version, afterVersion: next.version, correlationId: ctx.correlationId }, ctx.now);
    if (action !== 'cancel') {
      writeNotifications(
        tx,
        notificationsFor({
          kind: action === 'confirm' ? 'settlement.confirmed' : 'settlement.rejected',
          trip: tripRefOf(loaded.trip),
          actor: { uid: ctx.actorUid, name: actorName(loaded.members, ctx.actorUid) },
          settlementId: id,
          fromUid: data.fromUid,
          toUid: data.toUid,
          amountMinor: data.amountMinor,
        }),
        ctx.now,
      );
    }
    return { settlement: toDto(id, next), trip: toTripDto(tripId, trip) };
  });
}
