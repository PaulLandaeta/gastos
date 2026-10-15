import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Tests share the Firestore/Auth emulators: run files one by one.
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
