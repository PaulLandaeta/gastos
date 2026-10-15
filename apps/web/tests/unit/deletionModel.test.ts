import type { DeletionPreview } from 'contracts';
import { describe, expect, it } from 'vitest';
import { canConfirmDeletion, tripConsequences } from '../../src/features/account/deletionModel';

const trip = (over: Partial<DeletionPreview['trips'][number]> = {}): DeletionPreview['trips'][number] => ({
  tripId: 't1',
  name: 'Uyuni',
  currency: 'BOB',
  status: 'active',
  role: 'member',
  balanceMinor: 0,
  pendingSettlements: [],
  ...over,
});

describe('account deletion model (RF-56)', () => {
  it('confirms only with the exact word, online and without blocks', () => {
    const preview: DeletionPreview = { trips: [trip()], attachmentsToDelete: 0, blocked: false };
    expect(canConfirmDeletion('BORRAR', preview, true)).toBe(true);
    expect(canConfirmDeletion(' BORRAR ', preview, true)).toBe(true);
    expect(canConfirmDeletion('borrar', preview, true)).toBe(false);
    expect(canConfirmDeletion('BORRAR', preview, false)).toBe(false);
    expect(canConfirmDeletion('BORRAR', { ...preview, blocked: true }, true)).toBe(false);
    expect(canConfirmDeletion('BORRAR', undefined, true)).toBe(false);
  });

  it('explains balance, creator transfer and pending payments per trip', () => {
    expect(tripConsequences(trip({ balanceMinor: 1500 })).join(' ')).toMatch(/Te deben .*15,00/);
    expect(tripConsequences(trip({ balanceMinor: -1500 })).join(' ')).toMatch(/Debes .*15,00/);
    expect(tripConsequences(trip())).toContain('Sin saldo pendiente.');
    expect(tripConsequences(trip({ role: 'creator', successor: { uid: 'u', displayName: 'Ana' } }))).toContain('Ana pasará a ser la creadora del viaje.');
    expect(tripConsequences(trip({ role: 'creator' }))).toContain('Eres la única persona del viaje: quedará anonimizado.');
    expect(tripConsequences(trip({ pendingSettlements: [{ settlementId: 's', direction: 'outgoing', amountMinor: 100 }] })).join(' ')).toMatch(
      /1 pago pendiente/,
    );
  });
});
