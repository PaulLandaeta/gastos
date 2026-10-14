import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('el creador gestiona categorías; un participante no; las inactivas no se ofrecen', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO]);
  const pedro = pages[PEDRO.email]!;

  await ana.getByRole('link', { name: 'Categorías' }).click();
  await expect(ana.getByRole('heading', { name: 'Categorías' })).toBeVisible();
  await ana.getByLabel('Nombre de la categoría').fill('Excursiones');
  await ana.getByRole('button', { name: 'Crear categoría' }).click();
  await expect(ana.getByRole('listitem').filter({ hasText: 'Excursiones' })).toBeVisible();
  await ana.getByRole('listitem').filter({ hasText: 'Compras' }).getByRole('button', { name: 'Desactivar' }).click();
  await expect(ana.getByRole('listitem').filter({ hasText: 'Compras' })).toContainText('Inactiva');

  await pedro.getByRole('link', { name: 'Categorías' }).click();
  await expect(pedro.getByRole('listitem').filter({ hasText: 'Excursiones' })).toBeVisible();
  await expect(pedro.getByRole('button', { name: 'Crear categoría' })).toHaveCount(0);
  await expect(pedro.getByRole('button', { name: 'Desactivar' })).toHaveCount(0);

  await pedro.goBack();
  await pedro.getByRole('link', { name: 'Registro manual' }).click();
  const select = pedro.getByLabel('Categoría');
  await expect(select.locator('option', { hasText: 'Excursiones' })).toHaveCount(1);
  await expect(select.locator('option', { hasText: 'Compras' })).toHaveCount(0);
});
