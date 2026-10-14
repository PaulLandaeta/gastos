import { defineConfig, devices } from '@playwright/test';

const EMULATOR_ENV = {
  VITE_FIREBASE_API_KEY: 'demo-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-gastos.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-gastos',
  VITE_FIREBASE_APP_ID: 'demo-app',
  VITE_API_URL: 'http://localhost:8787/v1',
  VITE_USE_EMULATORS: 'true',
};

/**
 * E2E against the local stack: Firebase emulators (started separately with `pnpm emulators`),
 * the Worker API (wrangler dev) and the web app.
 * - `mobile-chrome`: Vite dev server (:5180), no service worker.
 * - `pwa`: production build served by `vite preview` (:5181) so the service worker, offline shell
 *   and install manifest are real.
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
    { name: 'mobile-chrome', testIgnore: 'pwa/**', use: { ...devices['Pixel 7'] } },
    { name: 'pwa', testMatch: 'pwa/**/*.spec.ts', use: { ...devices['Pixel 7'], baseURL: 'http://localhost:5181' } },
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
      env: EMULATOR_ENV,
    },
    {
      command: 'pnpm --filter web exec vite build --outDir dist-e2e && pnpm --filter web exec vite preview --outDir dist-e2e --port 5181 --strictPort',
      url: 'http://localhost:5181',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
      env: EMULATOR_ENV,
    },
  ],
});
