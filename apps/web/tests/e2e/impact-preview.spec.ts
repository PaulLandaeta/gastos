import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('con un pago confirmado, editar y anular muestran el impacto y piden confirmación', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO]);
  const pedro = pages[PEDRO.email]!;

  await ana.getByRole('link', { name: 'Registro manual' }).click();
  await ana.getByLabel('Descripción').fill('Cena');
  await ana.getByLabel('Importe total').fill('40');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  // Pedro owes Ana 20.00 and pays 10.00; Ana confirms.
  await pedro.reload();
  await pedro.getByRole('region', { name: 'Saldos' }).getByRole('link', { name: /Pagar/ }).click();
  await pedro.getByLabel('Importe pagado').fill('10');
  await pedro.getByRole('button', { name: 'Registrar pago' }).click();
  await ana.reload();
  await ana.getByRole('region', { name: 'Pagos' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(ana.getByRole('region', { name: 'Saldos' })).toContainText('le deben 10,00');

  // Edit: preview required.
  await ana.getByRole('link', { name: 'Ver gastos' }).click();
  await ana.getByRole('link', { name: /Cena/ }).click();
  await ana.getByRole('link', { name: 'Editar gasto' }).click();
  await ana.getByLabel('Importe total').fill('60');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  const impact = ana.getByRole('region', { name: 'Impacto en saldos' });
  await expect(impact).toBeVisible();
  await expect(impact).toContainText('Pedro');
  await impact.getByRole('button', { name: 'Confirmar cambios' }).click();
  await expect(ana.getByRole('heading', { name: 'Cena' })).toBeVisible();
  await expect(ana.getByText('60,00').first()).toBeVisible();

  // Void: preview required as well.
  await ana.getByRole('button', { name: 'Anular gasto' }).click();
  const voidImpact = ana.getByRole('region', { name: 'Impacto en saldos' });
  await expect(voidImpact).toBeVisible();
  await voidImpact.getByRole('button', { name: 'Confirmar cambios' }).click();
  await expect(ana.getByText('Anulado', { exact: true }).first()).toBeVisible();
});
