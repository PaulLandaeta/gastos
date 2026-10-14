import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { app } from '../../src/index.js';
import type { TestUser } from './emulator.js';
import { call } from './http.js';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const bytesOf = (text: string) => new TextEncoder().encode(text);

export interface TestFile {
  name: string;
  mimeType: string;
  data: Uint8Array;
  pages?: number;
  /** Declared size (defaults to the real one). */
  bytes?: number;
}

export const jpeg = (text: string, name = 'ticket.jpg'): TestFile => ({ name, mimeType: 'image/jpeg', data: bytesOf(text) });
export const pdf = (text: string, pages = 3, name = 'factura.pdf'): TestFile => ({ name, mimeType: 'application/pdf', data: bytesOf(text), pages });

export async function describeFiles(files: TestFile[]) {
  return Promise.all(
    files.map(async (f) => ({
      fileName: f.name,
      mimeType: f.mimeType,
      bytes: f.bytes ?? f.data.byteLength,
      pages: f.pages ?? 1,
      sha256: await sha256Hex(f.data),
    })),
  );
}

export const requestUploads = async (user: TestUser, tripId: string, files: TestFile[], target?: Record<string, string>) =>
  call(user, 'POST', `/v1/trips/${tripId}/uploads`, { body: { files: await describeFiles(files), ...(target ? { target } : {}) } });

/** Fetches a signed local-blob URL through the worker (the browser would hit it directly). */
export async function fetchSigned(url: string, init?: RequestInit) {
  const u = new URL(url);
  return app.request(u.pathname + u.search, init, env);
}

/** Requests upload URLs and PUTs every file; returns the upload ids. */
export async function upload(user: TestUser, tripId: string, files: TestFile[], target?: Record<string, string>): Promise<string[]> {
  const res = await requestUploads(user, tripId, files, target);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  const uploads = res.json.uploads as { id: string; uploadUrl: string; headers: Record<string, string> }[];
  for (const [i, u] of uploads.entries()) {
    const put = await fetchSigned(u.uploadUrl, { method: 'PUT', headers: u.headers, body: files[i]!.data });
    expect(put.status).toBe(200);
  }
  return uploads.map((u) => u.id);
}

export const consent = (user: TestUser) => call(user, 'POST', '/v1/me/ai-consent', { body: { version: '2026-10' } });

export const scan = (user: TestUser, tripId: string, uploadIds: string[], key: string = crypto.randomUUID()) =>
  call(user, 'POST', `/v1/trips/${tripId}/scans`, { body: { uploadIds }, headers: { 'idempotency-key': key } });
