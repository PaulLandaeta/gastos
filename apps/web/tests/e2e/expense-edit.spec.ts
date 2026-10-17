import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('editar un gasto y conflicto de edición concurrente (PRD)', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  await ana.getByRole('link', { name: 'Registro manual' }).click();
  await ana.getByLabel('Descripción').fill('Cena');
  await ana.getByLabel('Importe total').fill('30');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await ana.getByRole('tab', { name: 'Gastos' }).click();
  await ana.getByRole('link', { name: /Cena/ }).click();
  // Screens load on demand: the URL changes once the detail is ready.
  await ana.waitForURL(/\/expenses\/[^/]+$/);
  const detailUrl = ana.url();

  // Pedro (beneficiary, not author/admin) has no edit action.
  await pedro.goto(detailUrl);
  await expect(pedro.getByRole('heading', { name: 'Cena' })).toBeVisible();
  await expect(pedro.getByRole('link', { name: 'Editar gasto' })).toHaveCount(0);

  // Ana opens the editor in two tabs (version 1).
  await ana.getByRole('link', { name: 'Editar gasto' }).click();
  await ana.waitForURL(/\/edit$/);
  const second = await ana.context().newPage();
  await second.goto(ana.url());
  await expect(second.getByLabel('Descripción')).toHaveValue('Cena');

  await ana.getByLabel('Descripción').fill('Cena (ajustada)');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('heading', { name: 'Cena (ajustada)' })).toBeVisible();

  await second.getByLabel('Importe total').fill('45');
  await second.getByRole('button', { name: 'Guardar gasto' }).click();
  const conflict = second.getByRole('alert').filter({ hasText: 'Otra persona modificó el gasto' });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('Descripción');
  await expect(second.getByLabel('Importe total')).toHaveValue('45');

  await conflict.getByRole('button', { name: 'Recargar con la versión actual' }).click();
  await expect(second.getByLabel('Descripción')).toHaveValue('Cena (ajustada)');

  // History shows the edit.
  await ana.reload();
  await expect(ana.getByRole('region', { name: 'Historial' })).toContainText('Editado');
});
