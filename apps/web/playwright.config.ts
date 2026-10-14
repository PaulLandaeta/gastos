import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the local stack: Firebase emulators (started separately with `pnpm emulators`),
 * the Worker API (wrangler dev) and the Vite dev server.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    locale: 'es-ES',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter api exec wrangler dev --env emulator --port 8787',
      url: 'http://localhost:8787/v1/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter web dev',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        VITE_FIREBASE_API_KEY: 'demo-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'demo-gastos.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'demo-gastos',
        VITE_FIREBASE_APP_ID: 'demo-app',
        VITE_API_URL: 'http://localhost:8787/v1',
        VITE_USE_EMULATORS: 'true',
      },
    },
  ],
});
