import {
  RECENT_LOGIN_SECONDS,
  SCHEMA_VERSION,
  deletedMemberLabel,
  normalizeEmail,
  type DeletionPreview,
  type ReceiptStorageProvider,
} from 'contracts';
import type { AuthUser } from '../auth/verifyIdToken.js';
import { deleteAuthUser } from '../auth/identityToolkit.js';
import type { Env } from '../env.js';
import type { Doc, Firestore, Transaction } from '../firestore/client.js';
import { AppError } from '../http/errors.js';
import { log } from '../http/log.js';
import { writeAudit } from './audit.js';
import { ledgerPath } from './ledgerRepo.js';
import {
  creatorName,
  isDeleted,
  loadTripRaw,
  syncIndexes,
  writeTrip,
  type MemberData,
  type MemberRecord,
} from './tripRepo.js';

/**
 * Feature 006 — RF-56: account deletion and anonymization (research R1–R4).
 *
 * The member row keeps its key (the opaque uid) so every expense, payment, refund and the ledger
 * stay untouched: balances are identical by construction. Each trip is anonymized in its own
 * transaction and the progress lives in `accountDeletions/{uid}`, so a failure is resumed by the
 * next request or by the hourly cron without ever leaving a trip half done.
 */

export const registryPath = (uid: string) => `accountDeletions/${uid}`;

const STEPS = ['files', 'invitations', 'notifications', 'foreignNotifications', 'profile', 'auth'] as const;
type Step = (typeof STEPS)[number];

export interface DeletionRegistry {
  uid: string;
  status: 'in_progress' | 'completed';
  requestedAt: Date;
  completedAt: Date | null;
  tripIds: string[];
  pendingTripIds: string[];
  steps: Partial<Record<Step, boolean>>;
  formerNames: string[];
  formerEmail: string | null;
  attempts: number;
  schemaVersion: number;
  version: number;
}

/** Test-only fault injection (resumability tests). Never set outside tests. */
export const deletionTestHooks: { failAfterTrips: number | null } = { failAfterTrips: null };

const SYSTEM_ACTOR = 'system:account-deletion';
const BATCH = 100;

/** RF-56: a deleted account cannot come back through a still-valid ID token (≤ 1 h). */
export async function assertNotDeleted(reader: Pick<Firestore, 'get'> | Transaction, uid: string): Promise<void> {
  if (await reader.get(registryPath(uid))) throw new AppError('ACCOUNT_DELETED', 'This account was deleted');
}

const toRecord = (d: Doc): MemberRecord => ({ key: d.id, data: d.data as unknown as MemberData, updateTime: d.updateTime });

/** Successor of a leaving creator: oldest admin, otherwise oldest accepted participant. */
function successorOf(members: MemberRecord[], uid: string): MemberRecord | undefined {
  const candidates = members
    .filter((m) => m.key !== uid && m.data.invitationStatus === 'accepted' && m.data.uid && !isDeleted(m.data))
    .sort((a, b) => (a.data.joinOrder ?? 0) - (b.data.joinOrder ?? 0));
  return candidates.find((m) => m.data.role === 'admin') ?? candidates[0];
}

/** Expense in which the user is the only payer and the only beneficiary (its receipts go, PRD #2). */
function isPersonalOf(expense: Record<string, unknown>, uid: string): boolean {
  const payers = (expense['payerUids'] as string[] | undefined) ?? [];
  const beneficiaries = (expense['beneficiaryUids'] as string[] | undefined) ?? [];
  return payers.length === 1 && payers[0] === uid && beneficiaries.length === 1 && beneficiaries[0] === uid;
}

async function tripIdsOf(db: Firestore, uid: string): Promise<string[]> {
  return (await db.query(`users/${uid}/trips`)).map((d) => d.id);
}

async function pendingSettlementsOf(db: Firestore, tripId: string, uid: string) {
  const pending = await db.query(`trips/${tripId}/settlements`, { where: [['status', '==', 'pending']] });
  return pending
    .filter((s) => s.data['fromUid'] === uid || s.data['toUid'] === uid)
    .map((s) => ({
      settlementId: s.id,
      direction: (s.data['fromUid'] === uid ? 'outgoing' : 'incoming') as 'outgoing' | 'incoming',
      amountMinor: s.data['amountMinor'] as number,
    }));
}

/** GET /v1/me/deletion-preview (FR-001). */
export async function previewDeletion(db: Firestore, uid: string): Promise<DeletionPreview> {
  const tripIds = await tripIdsOf(db, uid);
  const trips = await Promise.all(
    tripIds.map(async (tripId) => {
      const [tripDoc, memberDocs, ledger, pendingSettlements, expenses] = await Promise.all([
        db.get(`trips/${tripId}`),
        db.query(`trips/${tripId}/members`),
        db.get(ledgerPath(tripId)),
        pendingSettlementsOf(db, tripId, uid),
        db.query(`trips/${tripId}/expenses`, { where: [['viewerUids', 'array-contains', uid]] }),
      ]);
      if (!tripDoc) return null;
      const members = memberDocs.map(toRecord);
      const me = members.find((m) => m.key === uid);
      if (!me || isDeleted(me.data)) return null;
      const successor = me.data.role === 'creator' ? successorOf(members, uid) : undefined;
      const attachments = expenses
        .filter((e) => e.data['status'] !== 'voided' && isPersonalOf(e.data, uid))
        .reduce((a, e) => a + ((e.data['attachmentCount'] as number | undefined) ?? 0), 0);
      return {
        trip: {
          tripId,
          name: tripDoc.data['name'] as string,
          currency: tripDoc.data['currency'] as string,
          status: tripDoc.data['status'] as DeletionPreview['trips'][number]['status'],
          role: me.data.role,
          balanceMinor: ((ledger?.data['netByMember'] as Record<string, number> | undefined) ?? {})[uid] ?? 0,
          ...(successor ? { successor: { uid: successor.key, displayName: successor.data.displayName ?? '' } } : {}),
          pendingSettlements,
        },
        attachments,
      };
    }),
  );
  const found = trips.filter((t) => t !== null);
  return {
    trips: found.map((t) => t.trip),
    attachmentsToDelete: found.reduce((a, t) => a + t.attachments, 0),
    blocked: found.some((t) => t.trip.pendingSettlements.length > 0),
  };
}

/** POST /v1/me/deletion (FR-002, FR-003, FR-010). */
export async function deleteAccount(
  db: Firestore,
  storage: ReceiptStorageProvider,
  env: Env,
  user: AuthUser,
  now: Date,
): Promise<{ status: 'in_progress' | 'completed'; tripsProcessed: number }> {
  if (Math.floor(now.getTime() / 1000) - user.authTime > RECENT_LOGIN_SECONDS) {
    throw new AppError('REAUTH_REQUIRED', 'Sign in again to delete your account');
  }
  const existing = await db.get(registryPath(user.uid));
  if (existing?.data['status'] === 'completed') return { status: 'completed', tripsProcessed: 0 };

  if (!existing) {
    const tripIds = await tripIdsOf(db, user.uid);
    const pending = (await Promise.all(tripIds.map(async (tripId) => (await pendingSettlementsOf(db, tripId, user.uid)).map((s) => ({ tripId, settlementId: s.settlementId }))))).flat();
    if (pending.length > 0) {
      throw new AppError('ACCOUNT_DELETION_BLOCKED', 'Resolve your pending payments first', { pendingSettlements: pending });
    }
    const profile = await db.get(`users/${user.uid}`);
    const formerNames = [profile?.data['displayName'], user.name].filter((n): n is string => typeof n === 'string' && n.length > 0);
    const email = (profile?.data['email'] as string | undefined) ?? (user.email ? normalizeEmail(user.email) : null);
    await db.runTransaction(async (tx) => {
      const registry: DeletionRegistry = {
        uid: user.uid,
        status: 'in_progress',
        requestedAt: now,
        completedAt: null,
        tripIds,
        pendingTripIds: tripIds,
        steps: {},
        formerNames: [...new Set(formerNames)],
        formerEmail: email,
        attempts: 0,
        schemaVersion: SCHEMA_VERSION,
        version: 1,
      };
      tx.set(registryPath(user.uid), { ...registry }, { exists: false });
    });
  }
  return continueDeletion(db, storage, env, user.uid, now);
}

/** Runs every remaining step; each one is idempotent and recorded in the registry. */
export async function continueDeletion(
  db: Firestore,
  storage: ReceiptStorageProvider,
  env: Env,
  uid: string,
  now: Date,
): Promise<{ status: 'in_progress' | 'completed'; tripsProcessed: number }> {
  const start = await db.get(registryPath(uid));
  if (!start) throw new AppError('NOT_FOUND', 'No deletion in progress');
  const registry = start.data as unknown as DeletionRegistry;
  if (registry.status === 'completed') return { status: 'completed', tripsProcessed: 0 };

  let processed = 0;
  for (const tripId of registry.pendingTripIds) {
    await anonymizeInTrip(db, uid, tripId, now);
    processed++;
    if (deletionTestHooks.failAfterTrips !== null && processed >= deletionTestHooks.failAfterTrips) {
      throw new Error('Injected failure (test)');
    }
  }

  const fresh = (await db.get(registryPath(uid)))!.data as unknown as DeletionRegistry;
  const run: Record<Step, () => Promise<void>> = {
    files: () => deleteFiles(db, storage, uid, fresh.tripIds, now),
    invitations: () => removeInvitations(db, fresh.formerEmail, now),
    notifications: () => deleteAll(db, `users/${uid}/notifications`),
    foreignNotifications: () => scrubForeignNotifications(db, uid, fresh.formerNames),
    profile: async () => {
      await deleteAll(db, `users/${uid}/trips`);
      await db.runTransaction(async (tx) => tx.delete(`users/${uid}`));
    },
    auth: () => deleteAuthUser(env, uid),
  };
  for (const step of STEPS) {
    if (fresh.steps[step]) continue;
    await run[step]();
    await updateRegistry(db, uid, (r) => ({ steps: { ...r.steps, [step]: true } }));
  }
  await updateRegistry(db, uid, () => ({ status: 'completed', completedAt: now, formerNames: [], formerEmail: null }));
  log('info', 'account_deleted', { trips: fresh.tripIds.length });
  return { status: 'completed', tripsProcessed: processed };
}

async function updateRegistry(db: Firestore, uid: string, patch: (r: DeletionRegistry) => Partial<DeletionRegistry>) {
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(registryPath(uid));
    if (!doc) return;
    const r = doc.data as unknown as DeletionRegistry;
    tx.update(registryPath(uid), { ...patch(r), version: r.version + 1 }, { updateTime: doc.updateTime });
  });
}

/** One transaction per trip: label, creator transfer, indexes and audit (FR-005, FR-007). */
export async function anonymizeInTrip(db: Firestore, uid: string, tripId: string, now: Date): Promise<void> {
  await db.runTransaction(async (tx) => {
    const regDoc = await tx.get(registryPath(uid));
    const registry = regDoc?.data as unknown as DeletionRegistry | undefined;
    const loaded = await loadTripRaw(tx, tripId);
    const me = loaded?.members.find((m) => m.key === uid);
    let formerName: string | null = null;

    if (loaded && me && !isDeleted(me.data)) {
      const { trip, members } = loaded;
      const ordinal = (trip.data.deletedMemberCount ?? 0) + 1;
      const successor = me.data.role === 'creator' ? successorOf(members, uid) : undefined;
      formerName = me.data.displayName;
      const anonymized: MemberData = {
        ...me.data,
        displayName: deletedMemberLabel(ordinal),
        email: '',
        role: me.data.role === 'creator' && !successor ? 'creator' : 'member',
        deletedAt: now,
        deletedOrdinal: ordinal,
        version: me.data.version + 1,
      };
      tx.set(`trips/${tripId}/members/${uid}`, { ...anonymized }, { updateTime: me.updateTime });
      const updated = members.map((m) => (m.key === uid ? { ...m, data: anonymized } : m));
      if (successor) {
        const promoted: MemberData = { ...successor.data, role: 'creator', version: successor.data.version + 1 };
        tx.set(`trips/${tripId}/members/${successor.key}`, { ...promoted }, { updateTime: successor.updateTime });
        const i = updated.findIndex((m) => m.key === successor.key);
        updated[i] = { ...successor, data: promoted };
      }
      const next = writeTrip(
        tx,
        trip,
        { deletedMemberCount: ordinal, ...(successor ? { creatorUid: successor.key } : {}) },
        now,
      );
      syncIndexes(tx, tripId, next, updated.map((m) => m.data), now, creatorName(updated));
      const correlationId = crypto.randomUUID();
      writeAudit(tx, { tripId, actorUid: SYSTEM_ACTOR, action: 'member.deleted', entityType: 'member', entityId: uid, beforeVersion: trip.data.version, afterVersion: next.version, correlationId, diff: { ordinal } }, now);
      if (successor) {
        writeAudit(tx, { tripId, actorUid: SYSTEM_ACTOR, action: 'member.creator_transferred', entityType: 'member', entityId: successor.key, beforeVersion: trip.data.version, afterVersion: next.version, correlationId, diff: { from: uid } }, now);
      }
    }
    tx.delete(`users/${uid}/trips/${tripId}`);
    if (regDoc && registry) {
      const names = formerName && !registry.formerNames.includes(formerName) ? [...registry.formerNames, formerName] : registry.formerNames;
      tx.update(
        registryPath(uid),
        { pendingTripIds: registry.pendingTripIds.filter((t) => t !== tripId), formerNames: names, version: registry.version + 1 },
        { updateTime: regDoc.updateTime },
      );
    }
  });
}

/** Receipts of personal expenses, unfinished uploads and scan drafts (PRD #2, FR-004). */
async function deleteFiles(db: Firestore, storage: ReceiptStorageProvider, uid: string, tripIds: string[], now: Date) {
  for (const tripId of tripIds) {
    const expenses = await db.query(`trips/${tripId}/expenses`, { where: [['viewerUids', 'array-contains', uid]] });
    for (const expense of expenses.filter((e) => isPersonalOf(e.data, uid))) {
      const attachments = await db.query(`${expense.path}/attachments`, { where: [['status', '==', 'active']] });
      for (const a of attachments) {
        await storage.delete(a.data['storageKey'] as string);
        await db.runTransaction(async (tx) => {
          const [fresh, parent] = await Promise.all([tx.get(a.path), tx.get(expense.path)]);
          if (!fresh || fresh.data['status'] !== 'active') return;
          const version = (fresh.data['version'] as number) + 1;
          tx.update(a.path, { status: 'deleted', deletedAt: now, version });
          if (parent) tx.update(expense.path, { attachmentCount: Math.max(0, ((parent.data['attachmentCount'] as number) ?? 1) - 1) });
          writeAudit(tx, { tripId, actorUid: SYSTEM_ACTOR, action: 'attachment.delete', entityType: 'attachment', entityId: expense.id, beforeVersion: version - 1, afterVersion: version, correlationId: crypto.randomUUID(), diff: { attachmentId: a.id } }, now);
        });
      }
    }
    for (const upload of await db.query(`trips/${tripId}/uploads`, { where: [['uploadedBy', '==', uid]] })) {
      if (upload.data['status'] === 'pending') await storage.delete(upload.data['storageKey'] as string);
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(upload.path);
        if (fresh?.data['status'] === 'pending') tx.update(upload.path, { status: 'deleted', deletedAt: now, version: ((fresh.data['version'] as number) ?? 1) + 1 });
      });
    }
    const scans = await db.query(`trips/${tripId}/scans`, { where: [['requestedBy', '==', uid]] });
    await deleteDocs(db, scans.map((s) => s.path));
  }
}

/** Pending or declined invitations addressed to the user: removed with their invitee row (FR-004). */
async function removeInvitations(db: Firestore, email: string | null, now: Date) {
  if (!email) return;
  for (const index of await db.query(`invitations/${email}/trips`)) {
    const tripId = index.id;
    await db.runTransaction(async (tx) => {
      const loaded = await loadTripRaw(tx, tripId);
      tx.delete(`invitations/${email}/trips/${tripId}`);
      const row = loaded?.members.find((m) => m.data.email === email && m.data.invitationStatus !== 'accepted');
      if (!loaded || !row) return;
      const { trip, members } = loaded;
      tx.delete(`trips/${tripId}/members/${row.key}`, { exists: true });
      const wasDeclined = row.data.invitationStatus === 'declined';
      const next = writeTrip(
        tx,
        trip,
        wasDeclined
          ? { declinedInvitationCount: Math.max(0, trip.data.declinedInvitationCount - 1) }
          : { pendingInvitationCount: Math.max(0, trip.data.pendingInvitationCount - 1) },
        now,
      );
      const remaining = members.filter((m) => m.key !== row.key);
      syncIndexes(tx, tripId, next, remaining.map((m) => m.data), now, creatorName(members));
      writeAudit(tx, { tripId, actorUid: SYSTEM_ACTOR, action: 'member.remove_invitation', entityType: 'invitation', entityId: row.key, beforeVersion: trip.data.version, afterVersion: next.version, correlationId: crypto.randomUUID(), diff: { reason: 'account_deleted' } }, now);
    });
  }
}

/** Other people's notifications caused by the user stop showing their name (FR-008). */
async function scrubForeignNotifications(db: Firestore, uid: string, formerNames: string[]) {
  const names = [...formerNames].filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0) return;
  const labels = new Map<string, string>();
  const labelFor = async (tripId: string) => {
    if (!labels.has(tripId)) {
      const member = await db.get(`trips/${tripId}/members/${uid}`);
      labels.set(tripId, (member?.data['displayName'] as string | undefined) ?? deletedMemberLabel(1));
    }
    return labels.get(tripId)!;
  };
  const docs = await db.query('notifications', { allDescendants: true, where: [['actorUid', '==', uid]] });
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const titles = await Promise.all(
      chunk.map(async (d) => {
        const label = await labelFor(d.data['tripId'] as string);
        let title = d.data['title'] as string;
        for (const name of names) title = title.split(name).join(label);
        return title;
      }),
    );
    await db.runTransaction(async (tx) => {
      chunk.forEach((d, j) => {
        if (titles[j] !== d.data['title']) tx.update(d.path, { title: titles[j] }, { exists: true });
      });
    });
  }
}

async function deleteDocs(db: Firestore, paths: string[]) {
  for (let i = 0; i < paths.length; i += BATCH) {
    await db.runTransaction(async (tx) => {
      for (const p of paths.slice(i, i + BATCH)) tx.delete(p);
    });
  }
}

async function deleteAll(db: Firestore, collection: string) {
  await deleteDocs(db, (await db.query(collection)).map((d) => d.path));
}

/** Hourly cron: finishes deletions left in progress by a failure (FR-010). */
export async function resumeDeletions(db: Firestore, storage: ReceiptStorageProvider, env: Env, now: Date, limit = 3): Promise<number> {
  const pending = await db.query('accountDeletions', { where: [['status', '==', 'in_progress']], limit });
  let completed = 0;
  for (const doc of pending) {
    try {
      await updateRegistry(db, doc.id, (r) => ({ attempts: r.attempts + 1 }));
      const res = await continueDeletion(db, storage, env, doc.id, now);
      if (res.status === 'completed') completed++;
    } catch (e) {
      log('warn', 'account_deletion_resume_failed', { message: e instanceof Error ? e.message : 'unknown' });
    }
  }
  return completed;
}

/**
 * After restoring a backup (FR-020): re-applies every deletion that the restored data does not
 * reflect. Sources: the registry (restored and, if given, the live one) and the uids that have a
 * profile or membership but no Auth account any more.
 */
export async function reconcileDeletions(
  db: Firestore,
  storage: ReceiptStorageProvider,
  env: Env,
  opts: { extraUids?: string[]; lookupAuth?: (uids: string[]) => Promise<Set<string>>; now?: Date } = {},
): Promise<string[]> {
  const now = opts.now ?? new Date();
  const registry = await db.query('accountDeletions');
  const candidates = new Set([...registry.map((d) => d.id), ...(opts.extraUids ?? [])]);
  if (opts.lookupAuth) {
    const profiles = (await db.query('users')).map((d) => d.id);
    const memberUids = (await db.query('members', { allDescendants: true }))
      .filter((d) => d.data['invitationStatus'] === 'accepted' && d.data['uid'] && d.data['deletedAt'] == null)
      .map((d) => d.data['uid'] as string);
    const known = [...new Set([...profiles, ...memberUids])];
    const alive = await opts.lookupAuth(known);
    for (const uid of known) if (!alive.has(uid)) candidates.add(uid);
  }
  const reapplied: string[] = [];
  for (const uid of candidates) {
    const memberships = (await db.query('members', { allDescendants: true, where: [['uid', '==', uid]] })).filter(
      (d) => d.data['invitationStatus'] === 'accepted' && d.data['deletedAt'] == null,
    );
    const profile = await db.get(`users/${uid}`);
    const reg = await db.get(registryPath(uid));
    if (memberships.length === 0 && !profile && reg?.data['status'] === 'completed') continue;
    const tripIds = [...new Set([...memberships.map((d) => d.path.split('/')[1]!), ...(await tripIdsOf(db, uid))])];
    await db.runTransaction(async (tx) => {
      const registryDoc: DeletionRegistry = {
        uid,
        status: 'in_progress',
        requestedAt: (reg?.data['requestedAt'] as Date | undefined) ?? now,
        completedAt: null,
        tripIds,
        pendingTripIds: tripIds,
        steps: { auth: false },
        formerNames: [profile?.data['displayName']].filter((n): n is string => typeof n === 'string'),
        formerEmail: (profile?.data['email'] as string | undefined) ?? null,
        attempts: 0,
        schemaVersion: SCHEMA_VERSION,
        version: ((reg?.data['version'] as number | undefined) ?? 0) + 1,
      };
      tx.set(registryPath(uid), { ...registryDoc });
    });
    await continueDeletion(db, storage, env, uid, now);
    reapplied.push(uid);
  }
  return reapplied;
}
