import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip, openTab } from './helpers';

test.beforeEach(resetEmulators);

test('dashboard: total compartido, personales, total global y filtros', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const juan = pages[JUAN.email]!;

  const register = async (description: string, amount: string, category: string, personal = false) => {
    await ana.getByRole('link', { name: 'Registro manual' }).click();
    await ana.getByLabel('Descripción').fill(description);
    await ana.getByLabel('Importe total').fill(amount);
    await ana.getByRole('radio', { name: category }).check();
    if (personal) await ana.getByLabel(/Gasto personal/).check();
    await ana.getByRole('button', { name: 'Guardar gasto' }).click();
    await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
  };
  await register('Cena', '90', 'Comida');
  await register('Bus', '30', 'Transporte');
  await register('Champú', '12', 'Compras', true);

  await openTab(ana, 'Resumen');
  const dash = ana.getByRole('region', { name: 'Resumen del viaje' });
  await expect(dash.getByText('Total compartido del viaje')).toBeVisible();
  await expect(dash).toContainText('120,00');
  await expect(dash.getByRole('group', { name: 'Tus gastos personales' })).toContainText('12,00');
  await expect(dash.getByRole('group', { name: 'Tu total global' })).toContainText('52,00');
  const chart = dash.getByRole('figure', { name: 'Gasto compartido por categoría' });
  await expect(chart).toContainText('Comida');
  await expect(chart).toContainText('Transporte');

  await dash.getByLabel('Categoría', { exact: true }).selectOption({ label: 'Comida' });
  await expect(dash.getByText(/filtrado/)).toBeVisible();
  await expect(chart).not.toContainText('Transporte');

  // Juan sees the public total too.
  await juan.reload();
  await openTab(juan, 'Resumen');
  await expect(juan.getByRole('region', { name: 'Resumen del viaje' })).toContainText('120,00');

  await ana.getByRole('tab', { name: 'Gastos' }).click();
  await ana.getByRole('tab', { name: 'Personales' }).click();
  await expect(ana.getByRole('tabpanel', { name: 'Personales' })).toContainText('Champú');
  await expect(ana.getByRole('tabpanel', { name: 'Personales' })).not.toContainText('Cena');
});
