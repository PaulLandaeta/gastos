import { DEFAULT_CATEGORIES, SCHEMA_VERSION, isDefaultCategoryId } from 'contracts';
import type { Firestore, Transaction } from '../firestore/client.js';
import { AppError, notFound } from '../http/errors.js';
import { writeAudit } from './audit.js';
import { assertMutable, loadTripForMember, newId, requireRole, type MutationContext } from './tripRepo.js';

export const categoriesPath = (tripId: string) => `trips/${tripId}/categories`;

export function defaultCategoryDocs(now: Date) {
  return DEFAULT_CATEGORIES.map((c) => ({
    id: c.id,
    data: {
      name: c.name,
      color: c.color,
      isDefault: true,
      active: true,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
      version: 1,
    },
  }));
}

/** Buffers the 6 initial categories (FR-014). */
export function seedDefaultCategories(tx: Transaction, tripId: string, now: Date): void {
  for (const c of defaultCategoryDocs(now)) tx.set(`${categoriesPath(tripId)}/${c.id}`, c.data);
}

/**
 * Validates that `categoryId` is an active category of the trip. Trips created before feature 002
 * have no categories: a `default-*` id seeds them in the same transaction (lazy migration).
 */
export async function ensureActiveCategory(tx: Transaction, tripId: string, categoryId: string, now: Date) {
  const doc = await tx.get(`${categoriesPath(tripId)}/${categoryId}`);
  if (doc) {
    if (doc.data['active'] !== true) throw new AppError('CATEGORY_INACTIVE', 'The category is not active');
    return;
  }
  if (isDefaultCategoryId(categoryId)) {
    const any = await tx.query(categoriesPath(tripId), { limit: 1 });
    if (any.length === 0) {
      seedDefaultCategories(tx, tripId, now);
      return;
    }
  }
  throw new AppError('CATEGORY_INACTIVE', 'Unknown category');
}


const normalize = (name: string) => name.trim().toLocaleLowerCase('es');

const toDto = (id: string, d: Record<string, unknown>) => ({
  id,
  name: d['name'] as string,
  color: d['color'] as string,
  isDefault: d['isDefault'] as boolean,
  active: d['active'] as boolean,
  version: d['version'] as number,
});

async function loadCategories(tx: Transaction, tripId: string, now: Date) {
  const docs = await tx.query(categoriesPath(tripId));
  if (docs.length > 0) return docs.map((d) => ({ id: d.id, data: d.data, updateTime: d.updateTime }));
  // Trips from feature 001 have no categories yet: seed them first.
  seedDefaultCategories(tx, tripId, now);
  return defaultCategoryDocs(now).map((c) => ({ id: c.id, data: c.data as Record<string, unknown>, updateTime: null as string | null }));
}

/** FR-015: creator/admin create categories with a unique (case-insensitive) name. */
export async function createCategory(db: Firestore, tripId: string, body: { name: string; color: string }, ctx: MutationContext) {
  return db.runTransaction(async (tx) => {
    const { trip, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    requireRole(me, ['creator', 'admin']);
    assertMutable(trip);
    const existing = await loadCategories(tx, tripId, ctx.now);
    if (existing.some((c) => normalize(c.data['name'] as string) === normalize(body.name))) {
      throw new AppError('DUPLICATE_CATEGORY', 'A category with this name already exists');
    }
    const id = newId();
    const data = {
      name: body.name.trim(),
      color: body.color.toLowerCase(),
      isDefault: false,
      active: true,
      createdBy: ctx.actorUid,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      schemaVersion: SCHEMA_VERSION,
      version: 1,
    };
    tx.set(`${categoriesPath(tripId)}/${id}`, data, { exists: false });
    writeAudit(tx, { tripId, actorUid: ctx.actorUid, action: 'category.create', entityType: 'category', entityId: id, beforeVersion: null, afterVersion: 1, correlationId: ctx.correlationId, diff: { name: data.name } }, ctx.now);
    return { category: toDto(id, data) };
  });
}

/** FR-015: rename, recolor, activate/deactivate (categories are never deleted). */
export async function updateCategory(
  db: Firestore,
  tripId: string,
  categoryId: string,
  body: { expectedVersion: number; name?: string | undefined; color?: string | undefined; active?: boolean | undefined },
  ctx: MutationContext,
) {
  return db.runTransaction(async (tx) => {
    const { trip, me } = await loadTripForMember(tx, tripId, ctx.actorUid);
    requireRole(me, ['creator', 'admin']);
    assertMutable(trip);
    const all = await loadCategories(tx, tripId, ctx.now);
    const current = all.find((c) => c.id === categoryId);
    if (!current) throw notFound('Category');
    if ((current.data['version'] as number) !== body.expectedVersion) {
      throw new AppError('CONFLICT', 'The category was modified by someone else', { currentVersion: current.data['version'] });
    }
    if (body.name !== undefined && all.some((c) => c.id !== categoryId && normalize(c.data['name'] as string) === normalize(body.name!))) {
      throw new AppError('DUPLICATE_CATEGORY', 'A category with this name already exists');
    }
    const data = {
      ...current.data,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.color !== undefined ? { color: body.color.toLowerCase() } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      updatedAt: ctx.now,
      version: (current.data['version'] as number) + 1,
    };
    tx.set(`${categoriesPath(tripId)}/${categoryId}`, data, current.updateTime ? { updateTime: current.updateTime } : undefined);
    writeAudit(tx, { tripId, actorUid: ctx.actorUid, action: 'category.update', entityType: 'category', entityId: categoryId, beforeVersion: current.data['version'] as number, afterVersion: data.version as number, correlationId: ctx.correlationId, diff: { name: body.name, active: body.active } }, ctx.now);
    return { category: toDto(categoryId, data) };
  });
}
