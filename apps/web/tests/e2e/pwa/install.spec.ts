import { expect, test } from '@playwright/test';
import { ANA, JUAN, resetEmulators, setupActiveTrip } from '../helpers';
import { waitForServiceWorker } from './pwaHelpers';

test.beforeEach(resetEmulators);

test('US2/SC-009: manifest instalable y service worker activo', async ({ page, request }) => {
  await page.goto('/login');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href!)).json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: 'Gastos de Viaje', short_name: 'Gastos', display: 'standalone', start_url: '/' });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f766e');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  await waitForServiceWorker(page);
  const state = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  expect(state).toBe('activated');
});

test('US2-3: sin conexión, una ruta profunda abre la app (no la página de error del navegador)', async ({ browser }) => {
  const { page, tripUrl } = await setupActiveTrip(browser, ANA, [JUAN]);
  await page.goto('/');
  await expect(page.getByText('Uyuni')).toBeVisible();
  await page.goto(tripUrl);
  await waitForServiceWorker(page);
  await page.context().setOffline(true);
  await page.goto(`${tripUrl}/expenses`);
  await expect(page.getByRole('heading', { name: 'Gastos' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mis viajes' })).toBeVisible();
  await expect(page.getByText('Uyuni')).toBeVisible();
});
