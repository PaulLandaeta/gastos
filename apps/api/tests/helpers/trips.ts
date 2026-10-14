import { expect } from 'vitest';
import type { TestUser } from './emulator.js';
import { call } from './http.js';

export interface TripBody {
  name?: string;
  startDate?: string;
  endDate?: string;
  currency?: string;
  inviteEmails?: string[];
}

export async function createTrip(user: TestUser, body: TripBody = {}) {
  const res = await call(user, 'POST', '/v1/trips', {
    body: { name: 'Uyuni', startDate: '2026-11-01', endDate: '2026-11-05', currency: 'USD', ...body },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.trip as { id: string; version: number; status: string } & Record<string, unknown>;
}

export async function accept(user: TestUser, tripId: string) {
  return call(user, 'POST', `/v1/trips/${tripId}/invitations/accept`);
}

/** Trip with `members` invited and all of them accepted (status active). */
export async function activeTrip(creator: TestUser, members: TestUser[], body: TripBody = {}) {
  const trip = await createTrip(creator, { ...body, inviteEmails: members.map((m) => m.email) });
  for (const m of members) expect((await accept(m, trip.id)).status).toBe(200);
  const res = await call(creator, 'GET', `/v1/trips/${trip.id}`);
  return res.json.trip as { id: string; version: number; status: string } & Record<string, unknown>;
}

export const setStatus = (user: TestUser, tripId: string, action: string, expectedVersion: number) =>
  call(user, 'POST', `/v1/trips/${tripId}/status`, { body: { expectedVersion, action } });

export function equalExpense(payerUid: string, beneficiaries: string[], totalMinor = 1000) {
  return {
    description: 'Cena',
    transactionDate: '2026-11-01',
    categoryId: 'default-food',
    totalMinor,
    payers: [{ uid: payerUid, amountMinor: totalMinor }],
    splitMode: 'total',
    items: [
      {
        id: 't',
        index: 0,
        grossMinor: totalMinor,
        discountMinor: 0,
        classification: 'shared',
        beneficiaries,
        allocation: { mode: 'equal' },
      },
    ],
    adjustments: [],
  };
}

export const postExpense = (user: TestUser, tripId: string, body: unknown, key: string | null = crypto.randomUUID()) =>
  call(user, 'POST', `/v1/trips/${tripId}/expenses`, {
    body,
    ...(key ? { headers: { 'idempotency-key': key } } : {}),
  });

export async function tripVersion(user: TestUser, tripId: string): Promise<number> {
  return (await call(user, 'GET', `/v1/trips/${tripId}`)).json.trip.version as number;
}
