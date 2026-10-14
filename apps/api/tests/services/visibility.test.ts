import { describe, expect, it } from 'vitest';
import { canViewExpense, canVoidExpense, viewerUidsOf } from '../../src/services/visibility.js';

const expense = {
  createdBy: 'author',
  payers: [{ uid: 'payer', amountMinor: 100 }],
  items: [
    { beneficiaries: ['payer', 'benef'] },
    { beneficiaries: ['benef'] },
  ],
  viewerUids: ['author', 'benef', 'payer'],
  status: 'active' as const,
};
const member = (uid: string, role: 'creator' | 'admin' | 'member' = 'member') => ({
  uid,
  role,
  invitationStatus: 'accepted' as const,
});

describe('visibility', () => {
  it('viewerUids = payers ∪ beneficiaries ∪ author, sorted and unique', () => {
    expect(viewerUidsOf(expense)).toEqual(['author', 'benef', 'payer']);
  });

  it.each([
    ['payer', member('payer'), true],
    ['beneficiary', member('benef'), true],
    ['author', member('author'), true],
    ['admin', member('adm', 'admin'), true],
    ['creator', member('boss', 'creator'), true],
    ['not involved member', member('juan'), false],
    ['demoted admin (now member)', member('ex', 'member'), false],
  ] as const)('canViewExpense: %s → %s', (_l, m, expected) => {
    expect(canViewExpense(m, expense)).toBe(expected);
  });

  it('non-accepted rows never see anything', () => {
    expect(canViewExpense({ uid: 'payer', role: 'member', invitationStatus: 'invited' }, expense)).toBe(false);
  });

  it('canVoidExpense: author, creator or admin, only active expenses on mutable trips', () => {
    expect(canVoidExpense(member('author'), expense, 'active')).toBe(true);
    expect(canVoidExpense(member('adm', 'admin'), expense, 'active')).toBe(true);
    expect(canVoidExpense(member('boss', 'creator'), expense, 'active')).toBe(true);
    expect(canVoidExpense(member('payer'), expense, 'active')).toBe(false);
    expect(canVoidExpense(member('author'), { ...expense, status: 'voided' }, 'active')).toBe(false);
    expect(canVoidExpense(member('author'), expense, 'closed')).toBe(false);
  });
});
