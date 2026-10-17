import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('lista, detalle con reparto, anulación con confirmación e historial', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const juan = pages[JUAN.email]!;

  await ana.getByRole('link', { name: 'Registro manual' }).click();
  await ana.getByLabel('Descripción').fill('Cena');
  await ana.getByLabel('Importe total').fill('10');
  await ana.getByRole('radio', { name: 'Comida' }).check();
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await ana.getByRole('tab', { name: 'Gastos' }).click();
  const row = ana.getByRole('link', { name: /Cena/ });
  await expect(row).toContainText('Comida');
  await expect(row).toContainText('pagó Ana');
  await row.click();

  await expect(ana.getByRole('heading', { name: 'Cena' })).toBeVisible();
  const split = ana.getByRole('region', { name: 'Reparto por persona' });
  await expect(split).toContainText('Ana');
  await expect(split).toContainText('3,34');

  // Juan is a beneficiary (can see it) but not author/admin: no void action.
  await juan.goto(ana.url());
  await expect(juan.getByRole('heading', { name: 'Cena' })).toBeVisible();
  await expect(juan.getByRole('button', { name: 'Anular gasto' })).toHaveCount(0);

  await ana.getByRole('button', { name: 'Anular gasto' }).click();
  await ana.getByRole('button', { name: 'Confirmar anulación' }).click();
  await expect(ana.getByText('Anulado', { exact: true }).first()).toBeVisible();
  const history = ana.getByRole('region', { name: 'Historial' });
  await expect(history).toContainText('Creado');
  await expect(history).toContainText('Anulado');

  await ana.getByRole('link', { name: 'Volver a gastos' }).click();
  await expect(ana.getByRole('link', { name: /Cena/ })).toContainText('Anulado');
});
