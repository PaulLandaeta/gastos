import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('aviso de posible duplicado: cancelar conserva el formulario, confirmar guarda; doble clic guarda una vez', async ({ browser }) => {
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);

  const fill = async () => {
    await page.getByRole('link', { name: 'Registro manual' }).click();
    await page.getByLabel('Descripción').fill('Cena');
    await page.getByLabel('Importe total').fill('45');
    await page.getByLabel('Fecha de la transacción').fill('2026-11-01');
  };

  await fill();
  await page.getByRole('button', { name: 'Guardar gasto' }).dblclick();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await fill();
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'Posible duplicado' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Cena');
  await warning.getByRole('button', { name: 'Cancelar' }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByLabel('Descripción')).toHaveValue('Cena');

  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.getByRole('alert').filter({ hasText: 'Posible duplicado' }).getByRole('button', { name: 'Guardar de todos modos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await page.getByRole('tab', { name: 'Gastos' }).click();
  await expect(page.getByRole('link', { name: /Cena/ })).toHaveCount(2);
});
