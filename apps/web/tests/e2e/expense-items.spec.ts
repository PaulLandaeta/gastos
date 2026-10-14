import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

test('factura mixta por ítems con asignación masiva, ítem personal, impuesto y dos pagadores', async ({ browser }) => {
  const { pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  const started = Date.now();
  await pedro.getByRole('link', { name: 'Registro manual' }).click();
  await pedro.getByLabel('Descripción').fill('Súper');
  await pedro.getByLabel('Importe total').fill('23,10');
  await pedro.getByRole('radio', { name: 'Por ítems de la factura' }).click();

  const items = pedro.getByRole('region', { name: 'Ítems' });
  for (const [name, amount] of [
    ['Pan', '6'],
    ['Agua', '3'],
    ['Champú', '12'],
  ] as const) {
    await items.getByRole('button', { name: 'Añadir ítem' }).click();
    const row = items.getByRole('group', { name: /^Ítem \d+$/ }).last();
    await row.getByLabel('Nombre del ítem').fill(name);
    await row.getByLabel('Importe del ítem').fill(amount);
  }
  await items.getByRole('group', { name: /^Ítem \d+$/ }).filter({ hasText: 'Pan' }).getByRole('checkbox', { name: 'Seleccionar ítem' }).check();
  await items.getByRole('group', { name: /^Ítem \d+$/ }).filter({ hasText: 'Agua' }).getByRole('checkbox', { name: 'Seleccionar ítem' }).check();
  await items.getByRole('button', { name: 'Asignar a…' }).click();
  const bulk = pedro.getByRole('group', { name: 'Asignar ítems seleccionados' });
  await bulk.getByRole('button', { name: 'Juan' }).click(); // deselect Juan → Ana + Pedro
  await bulk.getByRole('button', { name: 'Aplicar' }).click();

  const champu = items.getByRole('group', { name: /^Ítem \d+$/ }).filter({ hasText: 'Champú' });
  await champu.getByRole('checkbox', { name: 'Personal' }).check();
  await champu.getByRole('button', { name: 'Ana' }).click();

  await expect(pedro.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Faltan');
  await expect(pedro.getByRole('button', { name: 'Guardar gasto' })).toBeDisabled();
  await pedro.getByRole('button', { name: 'Añadir impuesto' }).click();
  await pedro.getByLabel('Importe del impuesto').fill('2,10');
  await expect(pedro.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Cuadra');
  await pedro.getByLabel('Varios pagadores').check();
  await pedro.getByLabel('Aporte de Pedro').fill('15');
  await pedro.getByRole('button', { name: 'Añadir pagador' }).click();
  await pedro.getByLabel('Pagador 2').selectOption({ label: 'Ana' });
  await expect(pedro.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Faltan');
  await pedro.getByLabel('Aporte de Ana').fill('8,10');
  await expect(pedro.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Cuadra');

  const preview = pedro.getByLabel('Reparto por persona');
  await expect(preview).toContainText('personal');
  await pedro.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(pedro.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
  console.log(`SC-002 automated flow: ${Date.now() - started} ms`);
});

test('alquiler de coche de 3 días como un único gasto', async ({ browser }) => {
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill('Alquiler de coche');
  await page.getByLabel('Importe total').fill('300');
  await page.getByLabel(/Servicio de varios días/).check();
  await page.getByLabel('Inicio del servicio').fill('2026-11-01');
  await page.getByLabel('Fin del servicio').fill('2026-11-03');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
});
