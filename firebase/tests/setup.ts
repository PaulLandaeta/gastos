import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

export const PROJECT_ID = 'demo-gastos';

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'),
    },
  });
}

export interface Who {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export function as(env: RulesTestEnvironment, who: Who | null): RulesTestContext {
  if (!who) return env.unauthenticatedContext();
  return env.authenticatedContext(who.uid, {
    email: who.email ?? `${who.uid}@example.com`,
    email_verified: who.emailVerified ?? true,
    firebase: { sign_in_provider: 'google.com' },
  });
}

/** Seeds documents bypassing rules (as the API would). */
export async function seed(env: RulesTestEnvironment, docs: Record<string, Record<string, unknown>>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of Object.entries(docs)) await db.doc(path).set(data);
  });
}
