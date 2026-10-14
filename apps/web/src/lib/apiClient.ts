import { isErrorCode, type ErrorCode } from 'contracts';
import { auth } from './firebase';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  query?: Record<string, string | number>;
}

/** Calls the Worker API with the current Firebase ID token and parses the error envelope. */
export async function api<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('UNAUTHENTICATED', 401, 'Sesión no iniciada');
  const token = await user.getIdToken();
  const url = new URL(`${import.meta.env.VITE_API_URL}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch {
    throw new ApiError('NETWORK', 0, 'No se pudo conectar con el servidor');
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (json as { error?: { code?: unknown; message?: string; details?: Record<string, unknown> } })?.error;
    const code = isErrorCode(err?.code) ? err.code : 'INTERNAL';
    throw new ApiError(code, res.status, err?.message ?? res.statusText, err?.details);
  }
  return json as T;
}
