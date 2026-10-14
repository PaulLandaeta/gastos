import { describe, expect, it } from 'vitest';
import { formatMinor, notificationsFor, type ExpenseSnap } from '../../src/services/notifications.js';

const trip = { id: 't1', name: 'Uyuni', currency: 'USD' };
const actor = { uid: 'ana', name: 'Ana' };

function expense(payers: Record<string, number>, charges: Record<string, number>, description = 'Cena'): ExpenseSnap {
  const total = Object.values(payers).reduce((a, b) => a + b, 0);
  return {
    description,
    totalMinor: total,
    payers: Object.entries(payers).map(([uid, amountMinor]) => ({ uid, amountMinor })),
    chargesByMember: Object.fromEntries(Object.entries(charges).map(([uid, netMinor]) => [uid, { netMinor }])),
  };
}

const recipients = (list: { recipientUid: string }[]) => list.map((n) => n.recipientUid).sort();

describe('notificationsFor — privacy and recipients (RF-18, RF-38)', () => {
  it('new expense: payers and beneficiaries except the author, with description and their share', () => {
    const list = notificationsFor({
      kind: 'expense.created',
      trip,
      actor,
      expenseId: 'e1',
      expense: expense({ ana: 3000 }, { ana: 1000, juan: 1000, pedro: 1000 }),
    });
    expect(recipients(list)).toEqual(['juan', 'pedro']);
    const juan = list.find((n) => n.recipientUid === 'juan')!;
    expect(juan).toMatchObject({
      type: 'expense.created',
      tripId: 't1',
      tripName: 'Uyuni',
      entity: { kind: 'expense', id: 'e1' },
      link: '/trips/t1/expenses/e1',
      actorUid: 'ana',
      title: 'Ana registró un gasto en Uyuni',
    });
    expect(juan.body).toBe('Cena · 30.00 USD · tu parte 10.00 USD');
  });

  it('a non-involved member (even a manager) gets nothing about a private expense', () => {
    const list = notificationsFor({
      kind: 'expense.created',
      trip,
      actor,
      expenseId: 'e1',
      expense: expense({ ana: 1000 }, { ana: 1000 }, 'Regalo sorpresa'),
    });
    expect(list).toEqual([]);
  });

  it('edit: only those whose paid or consumed amount changed, or who were added', () => {
    const before = expense({ ana: 3000 }, { ana: 1000, juan: 1000, pedro: 1000 });
    const after = { ...expense({ ana: 3000 }, { ana: 1000, juan: 1000, pedro: 1000 }), description: 'Cena (ajustada)' };
    expect(notificationsFor({ kind: 'expense.updated', trip, actor, expenseId: 'e1', before, after })).toEqual([]);

    const changed = expense({ ana: 3000 }, { ana: 1500, juan: 1500 });
    const withLuis = expense({ ana: 4000 }, { ana: 1000, juan: 1000, pedro: 1000, luis: 1000 });
    const list = notificationsFor({ kind: 'expense.updated', trip, actor, expenseId: 'e1', before, after: changed });
    // Juan's share changed; Pedro was removed (no details); Ana is the author.
    expect(list.map((n) => `${n.recipientUid}:${n.type}`).sort()).toEqual(['juan:expense.updated', 'pedro:expense.removed_from']);
    const pedro = list.find((n) => n.recipientUid === 'pedro')!;
    expect(pedro.body).toBeNull();
    expect(pedro.title).toBe('Ya no participas en un gasto de Uyuni');
    expect(JSON.stringify(pedro)).not.toContain('Cena');
    expect(pedro.link).toBe('/trips/t1/expenses');

    const added = notificationsFor({ kind: 'expense.updated', trip, actor, expenseId: 'e1', before, after: withLuis });
    expect(recipients(added)).toEqual(['luis']);
  });

  it('a payer whose paid amount changed is notified', () => {
    const before = expense({ ana: 2000, juan: 1000 }, { ana: 1500, juan: 1500 });
    const after = expense({ ana: 1000, juan: 2000 }, { ana: 1500, juan: 1500 });
    expect(recipients(notificationsFor({ kind: 'expense.updated', trip, actor, expenseId: 'e1', before, after }))).toEqual(['juan']);
  });

  it('void and restore notify participants except the author', () => {
    const e = expense({ juan: 2000 }, { ana: 1000, juan: 1000 });
    expect(recipients(notificationsFor({ kind: 'expense.voided', trip, actor, expenseId: 'e1', expense: e }))).toEqual(['juan']);
    expect(notificationsFor({ kind: 'expense.restored', trip, actor, expenseId: 'e1', expense: e })[0]!.title).toBe(
      'Ana restauró un gasto en Uyuni',
    );
  });

  it('payments: pending to the receiver, result to the emitter', () => {
    const pending = notificationsFor({ kind: 'settlement.pending', trip, actor, settlementId: 's1', fromUid: 'ana', toUid: 'juan', amountMinor: 1250 });
    expect(pending).toEqual([
      expect.objectContaining({ recipientUid: 'juan', title: 'Ana te registró un pago por confirmar', body: '12.50 USD', link: '/trips/t1' }),
    ]);
    const confirmed = notificationsFor({
      kind: 'settlement.confirmed',
      trip,
      actor: { uid: 'juan', name: 'Juan' },
      settlementId: 's1',
      fromUid: 'ana',
      toUid: 'juan',
      amountMinor: 1250,
    });
    expect(confirmed.map((n) => [n.recipientUid, n.title])).toEqual([['ana', 'Juan confirmó tu pago']]);
    const rejected = notificationsFor({
      kind: 'settlement.rejected',
      trip,
      actor: { uid: 'juan', name: 'Juan' },
      settlementId: 's1',
      fromUid: 'ana',
      toUid: 'juan',
      amountMinor: 1250,
    });
    expect(rejected[0]!.title).toBe('Juan rechazó tu pago');
  });

  it('refund: the recipient, with details only if they can see the expense', () => {
    const seen = notificationsFor({
      kind: 'refund.received',
      trip,
      actor,
      expenseId: 'e1',
      recipientUid: 'juan',
      amountMinor: 500,
      expenseDescription: 'Cena',
      recipientCanView: true,
    });
    expect(seen[0]).toMatchObject({ recipientUid: 'juan', body: 'Cena · 5.00 USD', link: '/trips/t1/expenses/e1' });
    const unseen = notificationsFor({
      kind: 'refund.received',
      trip,
      actor,
      expenseId: 'e1',
      recipientUid: 'luis',
      amountMinor: 500,
      expenseDescription: 'Regalo',
      recipientCanView: false,
    });
    expect(unseen[0]).toMatchObject({ recipientUid: 'luis', body: '5.00 USD', link: '/trips/t1' });
    expect(JSON.stringify(unseen)).not.toContain('Regalo');
    expect(notificationsFor({ kind: 'refund.received', trip, actor, expenseId: 'e1', recipientUid: 'ana', amountMinor: 5, expenseDescription: 'x', recipientCanView: true })).toEqual([]);
  });

  it('trip status and invitations carry no financial data', () => {
    const status = notificationsFor({ kind: 'trip.status_changed', trip, actor, status: 'closed', memberUids: ['ana', 'juan', 'pedro'] });
    expect(recipients(status)).toEqual(['juan', 'pedro']);
    expect(status[0]).toMatchObject({ title: 'Ana cerró el viaje Uyuni', body: null, link: '/trips/t1' });
    const invite = notificationsFor({ kind: 'invitation.received', trip, actor, inviteeUids: ['luis'] });
    expect(invite[0]).toMatchObject({ recipientUid: 'luis', title: 'Ana te invitó al viaje Uyuni', link: '/', entity: { kind: 'invitation', id: 't1' } });
  });

  it('expiring receipt: the given viewers, no actor exclusion', () => {
    const list = notificationsFor({
      kind: 'attachment.expiring',
      trip,
      attachmentId: 'a1',
      recipientUids: ['ana', 'juan'],
      link: '/trips/t1/expenses/e1',
      label: 'Cena',
      expiresAt: new Date('2026-11-01T00:00:00Z'),
    });
    expect(recipients(list)).toEqual(['ana', 'juan']);
    expect(list[0]).toMatchObject({ type: 'attachment.expiring', actorUid: 'system', body: 'Cena · se elimina el 2026-11-01' });
  });

  it('formats amounts with the currency decimals using integers', () => {
    expect(formatMinor(123456, 'USD')).toBe('1234.56 USD');
    expect(formatMinor(-5, 'USD')).toBe('-0.05 USD');
    expect(formatMinor(1500, 'JPY')).toBe('1500 JPY');
  });
});
