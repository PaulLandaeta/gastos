import { isEmulator, type Env } from '../env.js';
import { decodeFields, encodeFields, encodeValue, type Data, type Fields } from './codec.js';
import { getAccessToken } from './token.js';

export interface Doc {
  id: string;
  /** Path relative to the database root, e.g. `trips/t1/members/u1`. */
  path: string;
  data: Data;
  updateTime: string;
  createTime: string;
}

export interface Precondition {
  exists?: boolean;
  updateTime?: string;
}

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';

export interface QuerySpec {
  where?: [field: string, op: Op, value: unknown][];
  orderBy?: [field: string, direction: 'asc' | 'desc'][];
  limit?: number;
}

const OPS: Record<Op, string> = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  in: 'IN',
  'array-contains': 'ARRAY_CONTAINS',
};

const RETRYABLE = new Set(['ABORTED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS']);
const MAX_ATTEMPTS = 7; // 1 + 6 retries on ABORTED (research R2)

/** Exponential backoff with full jitter between transaction retries (I/O wait, not CPU). */
const backoff = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * 2 ** attempt));

export class FirestoreError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly status: string,
    message: string,
  ) {
    super(`Firestore ${status} (${httpStatus}): ${message}`);
    this.name = 'FirestoreError';
  }
}

interface RestDocument {
  name: string;
  fields?: Fields;
  updateTime: string;
  createTime: string;
}

type Write =
  | { update: { name: string; fields: Fields }; updateMask?: { fieldPaths: string[] }; currentDocument?: Precondition }
  | { delete: string; currentDocument?: Precondition };

/** Minimal Firestore REST client for workerd (research R2). */
export class Firestore {
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const host =
      isEmulator(env) && env.FIRESTORE_EMULATOR_HOST
        ? `http://${env.FIRESTORE_EMULATOR_HOST}`
        : 'https://firestore.googleapis.com';
    this.baseUrl = `${host}/v1`;
  }

  name(path: string): string {
    return `${this.root}/${path}`;
  }

  private url(resource: string): string {
    return `${this.baseUrl}/${resource.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessToken(this.env, this.fetchImpl);
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    if (!res.ok) {
      let status = 'UNKNOWN';
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { status?: string; message?: string } };
        status = body.error?.status ?? status;
        message = body.error?.message ?? message;
      } catch {
        // non-JSON error body
      }
      throw new FirestoreError(res.status, status, message);
    }
    return (await res.json()) as T;
  }

  private toDoc(raw: RestDocument): Doc {
    const path = raw.name.slice(this.root.length + 1);
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      data: decodeFields(raw.fields ?? {}),
      updateTime: raw.updateTime,
      createTime: raw.createTime,
    };
  }

  async get(path: string, transaction?: string): Promise<Doc | null> {
    // Transactional reads go through batchGet: a transactional GET on a missing document hangs
    // in the Firestore emulator, and batchGet behaves identically in production.
    if (transaction) return (await this.batchGet([path], transaction)).get(path) ?? null;
    try {
      return this.toDoc(await this.call<RestDocument>(this.url(this.name(path))));
    } catch (e) {
      if (e instanceof FirestoreError && e.httpStatus === 404) return null;
      throw e;
    }
  }

  async batchGet(paths: string[], transaction?: string): Promise<Map<string, Doc | null>> {
    const out = new Map<string, Doc | null>(paths.map((p) => [p, null]));
    if (paths.length === 0) return out;
    const res = await this.call<{ found?: RestDocument; missing?: string }[]>(
      `${this.url(this.root)}:batchGet`,
      {
        method: 'POST',
        body: JSON.stringify({ documents: paths.map((p) => this.name(p)), ...(transaction ? { transaction } : {}) }),
      },
    );
    for (const item of res) {
      if (item.found) {
        const doc = this.toDoc(item.found);
        out.set(doc.path, doc);
      }
    }
    return out;
  }

  async query(collectionPath: string, spec: QuerySpec = {}, transaction?: string): Promise<Doc[]> {
    const slash = collectionPath.lastIndexOf('/');
    const parent = slash === -1 ? this.root : this.name(collectionPath.slice(0, slash));
    const collectionId = collectionPath.slice(slash + 1);
    const filters = (spec.where ?? []).map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: encodeValue(value) },
    }));
    const structuredQuery: Record<string, unknown> = { from: [{ collectionId }] };
    if (filters.length === 1) structuredQuery['where'] = filters[0];
    if (filters.length > 1) structuredQuery['where'] = { compositeFilter: { op: 'AND', filters } };
    if (spec.orderBy) {
      structuredQuery['orderBy'] = spec.orderBy.map(([field, dir]) => ({
        field: { fieldPath: field },
        direction: dir === 'asc' ? 'ASCENDING' : 'DESCENDING',
      }));
    }
    if (spec.limit !== undefined) structuredQuery['limit'] = spec.limit;
    const res = await this.call<{ document?: RestDocument }[]>(`${this.url(parent)}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery, ...(transaction ? { transaction } : {}) }),
    });
    return res.filter((r) => r.document).map((r) => this.toDoc(r.document!));
  }

  /**
   * Runs `fn` inside a read-write transaction and commits its buffered writes atomically.
   * Retries on ABORTED (contention) re-running `fn` with fresh reads.
   */
  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    let retryTransaction: string | undefined;
    for (let attempt = 1; ; attempt++) {
      const { transaction } = await this.call<{ transaction: string }>(
        `${this.url(this.root)}:beginTransaction`,
        {
          method: 'POST',
          body: JSON.stringify({
            options: { readWrite: retryTransaction ? { retryTransaction } : {} },
          }),
        },
      );
      const tx = new Transaction(this, transaction);
      let result: T;
      try {
        result = await fn(tx);
      } catch (e) {
        await this.rollback(transaction);
        throw e;
      }
      try {
        await this.call(`${this.url(this.root)}:commit`, {
          method: 'POST',
          body: JSON.stringify({ writes: tx.writes, transaction }),
        });
        return result;
      } catch (e) {
        // ABORTED = contention. FAILED_PRECONDITION / ALREADY_EXISTS = a document read in this
        // transaction changed or was created concurrently (every precondition we send comes from a
        // read in the same transaction), so re-running `fn` with fresh reads is correct. Business
        // conflicts (expectedVersion) are raised inside `fn` and are not retried.
        if (e instanceof FirestoreError && RETRYABLE.has(e.status) && attempt < MAX_ATTEMPTS) {
          // Release any locks still held by the aborted attempt before retrying.
          await this.rollback(transaction);
          await backoff(attempt);
          retryTransaction = transaction;
          continue;
        }
        throw e;
      }
    }
  }

  private async rollback(transaction: string): Promise<void> {
    try {
      await this.call(`${this.url(this.root)}:rollback`, {
        method: 'POST',
        body: JSON.stringify({ transaction }),
      });
    } catch {
      // Best effort: the transaction expires on its own.
    }
  }
}

export class Transaction {
  readonly writes: Write[] = [];

  constructor(
    private readonly db: Firestore,
    readonly id: string,
  ) {}

  get(path: string): Promise<Doc | null> {
    return this.db.get(path, this.id);
  }

  getAll(paths: string[]): Promise<Map<string, Doc | null>> {
    return this.db.batchGet(paths, this.id);
  }

  query(collectionPath: string, spec?: QuerySpec): Promise<Doc[]> {
    return this.db.query(collectionPath, spec, this.id);
  }

  /** Replaces the whole document. */
  set(path: string, data: Data, precondition?: Precondition): void {
    this.writes.push({
      update: { name: this.db.name(path), fields: encodeFields(data) },
      ...(precondition ? { currentDocument: precondition } : {}),
    });
  }

  /** Overwrites only the given top-level fields; the document must exist. */
  update(path: string, data: Data, precondition: Precondition = { exists: true }): void {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    this.writes.push({
      update: { name: this.db.name(path), fields: encodeFields(data) },
      updateMask: { fieldPaths: keys.map((k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `\`${k}\``)) },
      currentDocument: precondition,
    });
  }

  delete(path: string, precondition?: Precondition): void {
    this.writes.push({ delete: this.db.name(path), ...(precondition ? { currentDocument: precondition } : {}) });
  }
}
