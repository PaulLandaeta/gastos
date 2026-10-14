import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('anular y restaurar un gasto devuelve los saldos; el historial lo registra', async ({ browser }) => {
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill('Taxi');
  await page.getByLabel('Importe total').fill('30');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('region', { name: 'Saldos' })).toContainText('le deben 15,00');

  await page.getByRole('link', { name: 'Ver gastos' }).click();
  await page.getByRole('link', { name: /Taxi/ }).click();
  await page.getByRole('button', { name: 'Anular gasto' }).click();
  await page.getByRole('button', { name: 'Confirmar anulación' }).click();
  await expect(page.getByText('Anulado', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Restaurar gasto' }).click();
  await expect(page.getByText('Anulado', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historial' })).toContainText('Restaurado');

  await page.getByRole('link', { name: 'Volver a gastos' }).click();
  await page.getByRole('link', { name: 'Volver al viaje' }).click();
  await expect(page.getByRole('region', { name: 'Saldos' })).toContainText('le deben 15,00');
});
