import type { Env } from '../../api/src/env.js';
import { isEmulator } from '../../api/src/env.js';
import { getAccessToken } from '../../api/src/firestore/token.js';

/** Raw REST document: `fields` keep the exact Firestore value encoding (lossless backups). */
export interface RawDoc {
  /** Path relative to the database root, e.g. `trips/t1/expenses/e1`. */
  name: string;
  fields: Record<string, unknown>;
}

const PAGE = 500;

export class RawFirestore {
  readonly root: string;
  private readonly base: string;

  constructor(private readonly env: Env) {
    this.root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const host = isEmulator(env) && env.FIRESTORE_EMULATOR_HOST ? `http://${env.FIRESTORE_EMULATOR_HOST}` : 'https://firestore.googleapis.com';
    this.base = `${host}/v1`;
  }

  private async call<T>(resource: string, body: unknown): Promise<T> {
    const token = await getAccessToken(this.env);
    const res = await fetch(`${this.base}/${resource}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Firestore ${resource.split(':').pop()} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Every document of a collection id at any depth, ordered by name, in pages of 500. */
  async *collectionGroup(collectionId: string): AsyncGenerator<RawDoc> {
    let after: string | null = null;
    for (;;) {
      const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId, allDescendants: true }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGE,
        ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
      };
      const rows = await this.call<{ document?: { name: string; fields?: Record<string, unknown> } }[]>(`${this.root}:runQuery`, { structuredQuery });
      const docs = rows.filter((r) => r.document).map((r) => r.document!);
      for (const d of docs) yield { name: d.name.slice(this.root.length + 1), fields: d.fields ?? {} };
      if (docs.length < PAGE) return;
      after = docs[docs.length - 1]!.name;
    }
  }

  /** Collection ids directly under `parent` ('' = database root). */
  async listCollectionIds(parent: string): Promise<string[]> {
    const resource = parent ? `${this.root}/${parent}` : this.root;
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.call<{ collectionIds?: string[]; nextPageToken?: string }>(`${resource}:listCollectionIds`, { pageSize: 1000, ...(pageToken ? { pageToken } : {}) });
      ids.push(...(res.collectionIds ?? []));
      pageToken = res.nextPageToken;
    } while (pageToken);
    return ids;
  }

  /** Non-transactional commit of full-document writes (≤ 500 per call). */
  async writeAll(docs: RawDoc[]): Promise<void> {
    for (let i = 0; i < docs.length; i += PAGE) {
      const writes = docs.slice(i, i + PAGE).map((d) => ({ update: { name: `${this.root}/${d.name}`, fields: d.fields } }));
      await this.call(`${this.root}:commit`, { writes });
    }
  }
}
