import { describe, expect, it } from 'vitest';
import {
  EXPORT_PAGE_SIZE,
  ExportQuery,
  NOTIFICATION_TYPES,
  Notification,
  NotificationsReadBody,
  NotificationsUnreadBody,
  TripExportPage,
  notificationExpiry,
} from '../src/index.js';

describe('notifications contracts (feature 005)', () => {
  it('lists every notification type of the data model', () => {
    expect(NOTIFICATION_TYPES).toEqual([
      'expense.created',
      'expense.updated',
      'expense.removed_from',
      'expense.voided',
      'expense.restored',
      'settlement.pending',
      'settlement.confirmed',
      'settlement.rejected',
      'refund.received',
      'attachment.expiring',
      'trip.status_changed',
      'invitation.received',
    ]);
  });

  it('read body accepts 1–100 ids or { all: true }', () => {
    expect(NotificationsReadBody.parse({ ids: ['a'] })).toEqual({ ids: ['a'] });
    expect(NotificationsReadBody.parse({ all: true })).toEqual({ all: true });
    expect(() => NotificationsReadBody.parse({ ids: [] })).toThrow();
    expect(() => NotificationsReadBody.parse({ ids: Array.from({ length: 101 }, (_, i) => `n${i}`) })).toThrow();
    expect(() => NotificationsReadBody.parse({ all: false })).toThrow();
    expect(() => NotificationsReadBody.parse({})).toThrow();
  });

  it('unread body only accepts ids', () => {
    expect(NotificationsUnreadBody.parse({ ids: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] });
    expect(() => NotificationsUnreadBody.parse({ all: true })).toThrow();
  });

  it('notification schema and 90-day expiry', () => {
    const createdAt = new Date('2026-10-14T10:00:00Z');
    const n = Notification.parse({
      id: 'n1',
      type: 'expense.created',
      tripId: 't1',
      tripName: 'Uyuni',
      entity: { kind: 'expense', id: 'e1' },
      title: 'Ana registró un gasto',
      body: 'Cena · Bs 120,00',
      link: '/trips/t1/expenses/e1',
      actorUid: 'ana',
      createdAt: createdAt.toISOString(),
      readAt: null,
      expiresAt: notificationExpiry(createdAt).toISOString(),
    });
    expect(n.body).toBe('Cena · Bs 120,00');
    expect(notificationExpiry(createdAt).toISOString()).toBe('2027-01-12T10:00:00.000Z');
  });
});

describe('export contracts (feature 005)', () => {
  it('query requires a known format and an optional opaque cursor', () => {
    expect(ExportQuery.parse({ format: 'xlsx' })).toEqual({ format: 'xlsx' });
    expect(ExportQuery.parse({ format: 'pdf', cursor: 'abc.def' }).cursor).toBe('abc.def');
    expect(() => ExportQuery.parse({ format: 'csv' })).toThrow();
    expect(() => ExportQuery.parse({})).toThrow();
  });

  it('page size is 100', () => expect(EXPORT_PAGE_SIZE).toBe(100));

  it('a later page has no header', () => {
    const page = TripExportPage.parse({ expenses: [], voidedExpenses: [], refunds: [], nextCursor: null });
    expect(page.header).toBeUndefined();
  });
});
