import { defineConfig } from 'vitest/config';

/** CPU budget checks: no coverage, which instruments every line and inflates timings 3–4×. */
export default defineConfig({
  test: { include: ['tests/perf/**/*.test.ts'], testTimeout: 60_000 },
});
