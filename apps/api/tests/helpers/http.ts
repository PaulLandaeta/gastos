import { env } from 'cloudflare:workers';
import { app } from '../../src/index.js';
import { emulatorToken, type TestUser } from './emulator.js';

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

/** Calls the app as `user` (or anonymously with `null`). */
export async function call(user: TestUser | null, method: string, path: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (user) headers['authorization'] = `Bearer ${emulatorToken(user)}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(
    path,
    { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) },
    env,
  );
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (text ? JSON.parse(text) : undefined) as any;
  return { status: res.status, json, headers: res.headers };
}

export const users = {
  ana: { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' },
  pedro: { uid: 'uid-pedro', email: 'pedro@example.com', name: 'Pedro' },
  juan: { uid: 'uid-juan', email: 'juan@example.com', name: 'Juan' },
  luis: { uid: 'uid-luis', email: 'luis@example.com', name: 'Luis' },
  eve: { uid: 'uid-eve', email: 'eve@example.com', name: 'Eve' },
} satisfies Record<string, TestUser>;
