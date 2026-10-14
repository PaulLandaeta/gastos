import { SCHEMA_VERSION, type Member, type Role, type Trip, type TripStatus } from 'contracts';
import type { Doc, Transaction } from '../firestore/client.js';
import { AppError, forbidden, notFound } from '../http/errors.js';

export type TripData = Omit<Trip, 'id'>;
export type MemberData = Omit<Member, 'key'>;

export interface TripRecord {
  id: string;
  data: TripData;
  updateTime: string;
}

export interface MemberRecord {
  key: string;
  data: MemberData;
  updateTime: string;
}

export interface LoadedTrip {
  trip: TripRecord;
  members: MemberRecord[];
  /** The caller's accepted membership. */
  me: MemberRecord;
}

/** Feature 006 (RF-56): the member deleted their account; the uid stays only as an opaque id. */
export const isDeleted = (m: Pick<MemberData, 'deletedAt'>) => m.deletedAt != null;

/** Uids of the accepted members that still have an account (notification recipients, actors). */
export function activeUids(members: { data: MemberData }[]): Set<string> {
  return new Set(
    members.filter((m) => m.data.invitationStatus === 'accepted' && m.data.uid && !isDeleted(m.data)).map((m) => m.data.uid!),
  );
}

/** Trip reference for notification texts (feature 005). */
export const tripRefOf = (trip: TripRecord) => ({ id: trip.id, name: trip.data.name, currency: trip.data.currency });

export interface MutationContext {
  actorUid: string;
  correlationId: string;
  now: Date;
}

export const tripPath = (tripId: string) => `trips/${tripId}`;
export const membersPath = (tripId: string) => `trips/${tripId}/members`;

/** Random document id (base62, 20 chars) like Firestore auto-ids. */
export function newId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Member key of a not-yet-accepted invitee: `inv_` + first 16 hex chars of sha256(email). */
export async function invitationKey(normalizedEmail: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedEmail));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `inv_${hex.slice(0, 16)}`;
}

function toRecord<T>(doc: Doc): { key: string; data: T; updateTime: string } {
  return { key: doc.id, data: doc.data as T, updateTime: doc.updateTime };
}

export function compareMembers(a: MemberRecord, b: MemberRecord): number {
  const ja = a.data.joinOrder ?? Number.MAX_SAFE_INTEGER;
  const jb = b.data.joinOrder ?? Number.MAX_SAFE_INTEGER;
  return ja - jb || (a.data.uid ?? '').localeCompare(b.data.uid ?? '') || a.data.email.localeCompare(b.data.email);
}

/**
 * Loads the trip and its member rows inside the transaction. Trips that do not exist or where
 * the caller is not an accepted member are reported as NOT_FOUND (no existence leak).
 */
export async function loadTripForMember(tx: Transaction, tripId: string, uid: string): Promise<LoadedTrip> {
  const [tripDoc, memberDocs] = await Promise.all([tx.get(tripPath(tripId)), tx.query(membersPath(tripId))]);
  if (!tripDoc) throw notFound('Trip');
  const members = memberDocs.map((d) => toRecord<MemberData>(d)).sort(compareMembers);
  const me = members.find((m) => m.key === uid && m.data.invitationStatus === 'accepted' && !isDeleted(m.data));
  if (!me) throw notFound('Trip');
  return { trip: { id: tripId, data: tripDoc.data as TripData, updateTime: tripDoc.updateTime }, members, me };
}

/** Loads the trip without membership checks (used by invitees accepting/declining). */
export async function loadTripRaw(
  tx: Transaction,
  tripId: string,
): Promise<{ trip: TripRecord; members: MemberRecord[] } | null> {
  const [tripDoc, memberDocs] = await Promise.all([tx.get(tripPath(tripId)), tx.query(membersPath(tripId))]);
  if (!tripDoc) return null;
  return {
    trip: { id: tripId, data: tripDoc.data as TripData, updateTime: tripDoc.updateTime },
    members: memberDocs.map((d) => toRecord<MemberData>(d)).sort(compareMembers),
  };
}

export function assertVersion(trip: TripRecord, expectedVersion: number): void {
  if (trip.data.version !== expectedVersion) {
    throw new AppError('CONFLICT', 'The trip was modified by someone else', {
      currentVersion: trip.data.version,
    });
  }
}

/** Closed and archived trips are read-only (FR-026). */
export function assertMutable(trip: TripRecord): void {
  if (trip.data.status === 'closed' || trip.data.status === 'archived') {
    throw new AppError('TRIP_READ_ONLY', 'The trip is read-only', { status: trip.data.status });
  }
}

export function requireRole(me: MemberRecord, roles: Role[]): void {
  if (!roles.includes(me.data.role)) throw forbidden('Your role does not allow this action');
}

/** pending ⇄ active is automatic: active only when nobody is invited or declined (FR-020). */
export function invitationStatus(data: TripData): TripStatus {
  if (data.status !== 'pending' && data.status !== 'active') return data.status;
  return data.pendingInvitationCount > 0 || data.declinedInvitationCount > 0 ? 'pending' : 'active';
}

/** Buffers the new trip state (version + 1) guarded by the read `updateTime`. */
export function writeTrip(tx: Transaction, trip: TripRecord, patch: Partial<TripData>, now: Date): TripData {
  const next: TripData = { ...trip.data, ...patch, updatedAt: now, version: trip.data.version + 1 };
  next.status = invitationStatus(next);
  tx.set(tripPath(trip.id), { ...next }, { updateTime: trip.updateTime });
  return next;
}

export function userTripIndex(tripId: string, trip: TripData, role: Role, now: Date) {
  return {
    tripId,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    currency: trip.currency,
    status: trip.status,
    role,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    version: trip.version,
  };
}

/** Rewrites the "mis viajes" index of every accepted member and the invitations of invitees. */
export function syncIndexes(
  tx: Transaction,
  tripId: string,
  trip: TripData,
  members: MemberData[],
  now: Date,
  inviterDisplayName: string,
): void {
  for (const m of members) {
    if (m.invitationStatus === 'accepted' && m.uid) {
      // A deleted member (RF-56) has no account any more: never recreate their index.
      if (isDeleted(m)) continue;
      tx.set(`users/${m.uid}/trips/${tripId}`, userTripIndex(tripId, trip, m.role, now));
    } else if (m.invitationStatus === 'invited' || m.invitationStatus === 'declined') {
      tx.set(`invitations/${m.email}/trips/${tripId}`, invitationIndex(tripId, trip, m.invitationStatus, inviterDisplayName, now));
    }
  }
}

export function invitationIndex(
  tripId: string,
  trip: TripData,
  status: 'invited' | 'declined',
  inviterDisplayName: string,
  now: Date,
) {
  return {
    tripId,
    tripName: trip.name,
    inviterDisplayName,
    startDate: trip.startDate,
    endDate: trip.endDate,
    currency: trip.currency,
    status,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    version: trip.version,
  };
}

export function creatorName(members: MemberRecord[]): string {
  const creator = members.find((m) => m.data.role === 'creator');
  return creator?.data.displayName ?? creator?.data.email ?? '';
}

export const toTripDto = (id: string, data: TripData): Trip => ({ id, ...data });
export const toMemberDto = (m: MemberRecord): Member => ({ key: m.key, ...m.data });
