import { defineConfig } from 'vitest/config';

/** CPU budget checks run in Node: workerd freezes timers between I/O, so it cannot measure CPU. */
export default defineConfig({
  test: { include: ['perf/**/*.perf.ts'], environment: 'node', testTimeout: 60_000 },
});
