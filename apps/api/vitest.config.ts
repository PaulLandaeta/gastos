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
          FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
          ALLOWED_ORIGINS: 'http://localhost:5180',
          AI_PROVIDER: 'fake',
          STORAGE: 'local',
          LOCAL_BLOB_SECRET: 'test-secret',
          PUBLIC_API_URL: 'http://localhost:8787',
          AI_QUOTA_TRIP_DAY: '20',
          AI_QUOTA_GLOBAL_DAY: '100',
          AI_QUOTA_GLOBAL_MONTH: '1500',
          ADMIN_UIDS: 'uid-admin',
        },
        r2Buckets: ['LOCAL_BLOBS'],
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
