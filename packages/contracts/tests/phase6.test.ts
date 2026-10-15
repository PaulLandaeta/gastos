import { describe, expect, it } from 'vitest';
import {
  CreateSettlementBody,
  DeleteAccountBody,
  DeletionPreview,
  ERROR_HTTP_STATUS,
  Member,
  Trip,
  deletedMemberLabel,
} from '../src/index.js';

describe('error codes (feature 006)', () => {
  it('maps the new codes to their HTTP status', () => {
    expect(ERROR_HTTP_STATUS.ACCOUNT_DELETION_BLOCKED).toBe(409);
    expect(ERROR_HTTP_STATUS.REAUTH_REQUIRED).toBe(401);
    expect(ERROR_HTTP_STATUS.ACCOUNT_DELETED).toBe(403);
    expect(ERROR_HTTP_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe('account deletion contracts (RF-56)', () => {
  it('requires the literal confirmation word', () => {
    expect(DeleteAccountBody.safeParse({ confirm: 'BORRAR' }).success).toBe(true);
    expect(DeleteAccountBody.safeParse({ confirm: 'borrar' }).success).toBe(false);
    expect(DeleteAccountBody.safeParse({}).success).toBe(false);
    expect(DeleteAccountBody.safeParse({ confirm: 'BORRAR', extra: 1 }).success).toBe(false);
  });

  it('parses a deletion preview', () => {
    const preview = {
      trips: [
        {
          tripId: 't1',
          name: 'Uyuni',
          currency: 'BOB',
          status: 'active',
          role: 'creator',
          balanceMinor: -1500,
          successor: { uid: 'uid-ana', displayName: 'Ana' },
          pendingSettlements: [{ settlementId: 's1', direction: 'outgoing', amountMinor: 500 }],
        },
      ],
      attachmentsToDelete: 2,
      blocked: true,
    };
    expect(DeletionPreview.parse(preview)).toEqual(preview);
  });

  it('labels deleted members with a stable ordinal', () => {
    expect(deletedMemberLabel(1)).toBe('Participante eliminado 1');
    expect(deletedMemberLabel(2)).toBe('Participante eliminado 2');
  });

  it('members and trips carry the deletion fields (optional for older documents)', () => {
    const member = {
      key: 'uid-pedro',
      uid: 'uid-pedro',
      email: '',
      displayName: 'Participante eliminado 1',
      role: 'member',
      invitationStatus: 'accepted',
      invitedAt: null,
      acceptedAt: '2026-10-01T00:00:00.000Z',
      joinOrder: 1,
      deletedAt: '2026-10-14T00:00:00.000Z',
      deletedOrdinal: 1,
      schemaVersion: 1,
      version: 2,
    };
    expect(Member.parse(member).deletedOrdinal).toBe(1);
    const { deletedAt: _a, deletedOrdinal: _o, ...legacy } = member;
    expect(Member.safeParse(legacy).success).toBe(true);
    expect(Trip.shape.deletedMemberCount.safeParse(undefined).success).toBe(true);
  });
});

describe('settlements on behalf of a deleted member (FR-009)', () => {
  it('accepts an optional fromUid', () => {
    expect(CreateSettlementBody.safeParse({ toUid: 'b', amountMinor: 100, fromUid: 'a' }).success).toBe(true);
    expect(CreateSettlementBody.safeParse({ toUid: 'b', amountMinor: 100, fromUid: '' }).success).toBe(false);
  });
});
