import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ENVIRONMENT: 'emulator',
          FIREBASE_PROJECT_ID: 'demo-gastos',
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
          ALLOWED_ORIGINS: 'http://localhost:5180',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    // Tests share one Firestore emulator; run files sequentially to keep data isolated per file.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
