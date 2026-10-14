import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'firebase',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
