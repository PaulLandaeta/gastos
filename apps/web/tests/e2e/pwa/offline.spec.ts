import { expect, test } from '@playwright/test';
import { ANA, JUAN, resetEmulators, setupActiveTrip } from '../helpers';
import { addSimpleExpense, statusBar, storedExpenses, tripIdOf, waitForServiceWorker } from './pwaHelpers';

test.beforeEach(resetEmulators);

test('US1: sin conexión consulta lo ya visto, registra pendientes y se sincronizan una sola vez', async ({ browser }) => {
  const { page, tripUrl } = await setupActiveTrip(browser, ANA, [JUAN]);
  const tripId = tripIdOf(tripUrl);
  // Seen once with connection: trip, balances and the expense list.
  await addSimpleExpense(page, 'Hotel', '20,00');
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saldos' })).toContainText('10,00');
  await page.getByRole('link', { name: 'Ver gastos' }).click();
  await expect(page.getByText('Hotel')).toBeVisible();
  await page.goto(tripUrl);
  await expect(page.getByRole('region', { name: 'Saldos' })).toContainText('10,00');
  await waitForServiceWorker(page);
  await page.waitForTimeout(1_000); // persisted-query throttle

  // SC-002: offline reload shows the last state in < 3 s.
  await page.context().setOffline(true);
  const started = Date.now();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Uyuni' })).toBeVisible();
  const elapsed = Date.now() - started;
  console.log(`SC-002 offline open: ${elapsed} ms`);
  expect(elapsed).toBeLessThan(3_000);
  await expect(statusBar(page)).toContainText('Sin conexión');
  await expect(page.getByRole('region', { name: 'Saldos' })).toContainText('10,00');

  // Two expenses while offline → pending, counted in the status bar.
  await addSimpleExpense(page, 'Cena', '10,00');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado sin conexión' })).toBeVisible();
  await addSimpleExpense(page, 'Taxi', '4,00');
  await expect(statusBar(page)).toContainText('2 pendientes');

  // Still there after reloading offline (IndexedDB); listed with their label.
  await page.reload();
  await expect(statusBar(page)).toContainText('2 pendientes');
  await page.getByRole('link', { name: 'Ver gastos' }).click();
  const pendingSection = page.getByRole('region', { name: 'Gastos pendientes de enviar' });
  await expect(pendingSection.getByRole('listitem')).toHaveCount(2);
  await expect(pendingSection).toContainText('Pendiente');

  // FR-003a: edit one offline (same key).
  await page.goto('/pending');
  await page.getByRole('link', { name: 'Editar Taxi' }).click();
  await expect(page.getByRole('heading', { name: 'Corregir gasto pendiente' })).toBeVisible();
  await page.getByLabel('Importe total').fill('5,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('heading', { name: 'Gastos pendientes' })).toBeVisible();
  await expect(page.getByText('5,00')).toBeVisible();

  // Online again: sent automatically, exactly once each.
  await page.context().setOffline(false);
  await expect(page.getByText('No tienes gastos pendientes de enviar.')).toBeVisible({ timeout: 20_000 });
  await expect(statusBar(page)).toHaveCount(0);
  const stored = await storedExpenses(tripId);
  expect(stored.map((e) => `${e.description}:${e.totalMinor}`).sort()).toEqual(['Cena:1000', 'Hotel:2000', 'Taxi:500']);

  // Balances now include them: Ana paid 35,00 shared with Juan → Juan owes 17,50.
  await page.goto(tripUrl);
  await expect(page.getByRole('region', { name: 'Saldos' })).toContainText('17,50');
});
