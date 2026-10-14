import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('devolución parcial de un ítem con importe sugerido y máximo', async ({ browser }) => {
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill('Súper');
  await page.getByLabel('Importe total').fill('30');
  await page.getByRole('radio', { name: 'Por ítems de la factura' }).click();
  const items = page.getByRole('region', { name: 'Ítems' });
  await items.getByRole('button', { name: 'Añadir ítem' }).click();
  const row = items.getByRole('group', { name: /^Ítem \d+$/ }).last();
  await row.getByLabel('Nombre del ítem').fill('Vino');
  await row.getByLabel('Importe del ítem').fill('30');
  await row.getByLabel('Cantidad').fill('3');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await page.getByRole('link', { name: 'Ver gastos' }).click();
  await page.getByRole('link', { name: /Súper/ }).click();
  await page.getByRole('button', { name: 'Registrar devolución de Vino' }).click();
  const form = page.getByRole('region', { name: 'Devolución de Vino' });
  await form.getByLabel('Unidades devueltas').fill('1');
  await expect(form.getByLabel('Importe devuelto')).toHaveValue('10,00');
  await expect(form).toContainText('Máximo disponible');
  await form.getByLabel('¿Quién recibió el dinero?').selectOption({ label: 'Pedro' });
  await form.getByRole('button', { name: 'Registrar devolución' }).click();

  const refunds = page.getByRole('list', { name: 'Devoluciones de Vino' });
  await expect(refunds).toContainText('10,00');
  await expect(refunds).toContainText('Pedro');

  await page.getByRole('button', { name: 'Registrar devolución de Vino' }).click();
  await form.getByLabel('Unidades devueltas').fill('3');
  await form.getByRole('button', { name: 'Registrar devolución' }).click();
  await expect(form.getByRole('alert')).toContainText('supera lo reembolsable');
});
