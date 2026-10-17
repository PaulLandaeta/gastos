import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip } from '../helpers';
import { addSimpleExpense, waitForServiceWorker } from './pwaHelpers';

test.beforeEach(resetEmulators);

test('FR-009: al reconectar, la caché deja de mostrar un gasto que Juan ya no puede ver', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const juan = pages[JUAN.email]!;
  await addSimpleExpense(ana, 'Cena', '30,00');
  await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await juan.getByRole('tab', { name: 'Gastos' }).click();
  await expect(juan.getByText('Cena')).toBeVisible();
  await waitForServiceWorker(juan);
  await juan.context().setOffline(true);
  await juan.reload();
  await expect(juan.getByText('Cena')).toBeVisible(); // cached while offline

  // Ana removes Juan from the expense while he is offline.
  await ana.getByRole('tab', { name: 'Gastos' }).click();
  await ana.getByRole('link', { name: /Cena/ }).click();
  await ana.getByRole('link', { name: 'Editar gasto' }).click();
  await ana.getByRole('button', { name: 'Juan', pressed: true }).first().click();
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('heading', { name: 'Cena' })).toBeVisible();

  await juan.context().setOffline(false);
  await expect(juan.getByText('Cena')).toHaveCount(0, { timeout: 20_000 });
});
