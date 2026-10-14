import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from '../helpers';
import { addSimpleExpense, statusBar, waitForServiceWorker } from './pwaHelpers';

test.beforeEach(resetEmulators);

test('US1-4: un pendiente rechazado (viaje cerrado) queda en «requiere atención» y solo se puede descartar', async ({ browser }) => {
  // Pedro creates the trip (manager); Ana participates from her phone.
  const { page: pedro, pages } = await setupActiveTrip(browser, PEDRO, [ANA]);
  const ana = pages[ANA.email]!;
  await waitForServiceWorker(ana);

  await ana.context().setOffline(true);
  // FR-007: online-only actions say so; manual registration stays available.
  await expect(ana.getByRole('button', { name: /Escanear factura.*Necesita conexión/ })).toBeDisabled();
  await addSimpleExpense(ana, 'Cena', '12,00');
  await expect(statusBar(ana)).toContainText('1 pendiente');

  // Meanwhile Pedro closes the trip.
  await pedro.getByRole('button', { name: 'Cerrar viaje' }).click();
  await expect(pedro.getByText('Cerrado', { exact: true })).toBeVisible();

  await ana.context().setOffline(false);
  await expect(statusBar(ana)).toContainText('1 requiere atención', { timeout: 20_000 });
  await ana.goto('/pending');
  await expect(ana.getByRole('main').getByText('Requiere atención')).toBeVisible();
  await expect(ana.getByText('Motivo: El viaje está en solo lectura.')).toBeVisible();
  // Not recoverable: no edit, never resent; only an explicit discard removes it (SC-004).
  await expect(ana.getByRole('link', { name: /Editar/ })).toHaveCount(0);
  await ana.reload();
  await expect(ana.getByRole('main').getByText('Requiere atención')).toBeVisible();
  await ana.getByRole('button', { name: 'Descartar Cena' }).click();
  await ana.getByRole('button', { name: 'Sí, descartar' }).click();
  await expect(ana.getByText('No tienes gastos pendientes de enviar.')).toBeVisible();
  await expect(statusBar(ana)).toHaveCount(0);
});
