import { defineConfig } from 'vitest/config';

export default defineConfig({
  // fake-indexeddb gives unit tests a real IndexedDB implementation (outbox, tripAccess).
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', setupFiles: ['fake-indexeddb/auto'] },
});
