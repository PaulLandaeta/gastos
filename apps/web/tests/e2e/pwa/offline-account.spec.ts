import { expect, test } from '@playwright/test';
import { ANA, JUAN, resetEmulators, setupActiveTrip } from '../helpers';
import { addSimpleExpense, statusBar, waitForServiceWorker } from './pwaHelpers';

test.beforeEach(resetEmulators);

test('FR-008: cerrar sesión con pendientes avisa y otra cuenta no ve nada de la anterior', async ({ browser }) => {
  const { page: ana } = await setupActiveTrip(browser, ANA, [JUAN]);
  await waitForServiceWorker(ana);
  await ana.context().setOffline(true);
  await addSimpleExpense(ana, 'Secreto de Ana', '9,00');
  await expect(statusBar(ana)).toContainText('1 pendiente');
  // Signing out works offline; the pending expense is still on the device, so it warns first.
  await ana.getByRole('button', { name: /Cuenta de Ana/ }).click();
  await ana.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  const warning = ana.getByRole('alertdialog');
  await expect(warning).toContainText('Tienes 1 gasto sin enviar');
  await warning.getByRole('button', { name: 'Borrar y cerrar sesión' }).click();
  await expect(ana).toHaveURL(/\/login/);
  await ana.context().setOffline(false);

  // Same browser, another account: no cache, no pending queue from Ana. (Login may send it back
  // to Ana's last trip, which it cannot open: «No encontrado».)
  await ana.waitForFunction(() => typeof (window as unknown as { __e2eSignIn?: unknown }).__e2eSignIn === 'function');
  await ana.evaluate(() => (window as unknown as { __e2eSignIn: (e: string, n: string) => Promise<void> }).__e2eSignIn('otro@example.com', 'Otro'));
  await expect(ana.getByRole('button', { name: /Cuenta de Otro/ })).toBeVisible();
  await ana.goto('/');
  await expect(ana.getByRole('heading', { name: 'Mis viajes' })).toBeVisible();
  await expect(ana.getByText('Uyuni')).toHaveCount(0);
  await expect(statusBar(ana)).toHaveCount(0);
  await ana.goto('/pending');
  await expect(ana.getByText('No tienes gastos pendientes de enviar.')).toBeVisible();
});

test('FR-008: con pendientes, cerrar sesión pide confirmación y se puede cancelar', async ({ browser }) => {
  const { page: ana } = await setupActiveTrip(browser, ANA, [JUAN]);
  await waitForServiceWorker(ana);
  await ana.context().setOffline(true);
  await addSimpleExpense(ana, 'Cena', '9,00');
  await ana.getByRole('button', { name: /Cuenta de Ana/ }).click();
  await ana.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  const warning = ana.getByRole('alertdialog');
  await expect(warning).toContainText('Tienes 1 gasto sin enviar');
  await warning.getByRole('button', { name: 'Cancelar' }).click();
  await expect(statusBar(ana)).toContainText('1 pendiente');
});
