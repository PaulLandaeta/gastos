import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // CPU budget checks run without coverage instrumentation (`pnpm --filter finance-engine perf`).
    exclude: ['tests/perf/**', '**/node_modules/**'],
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
