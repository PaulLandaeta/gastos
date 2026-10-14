import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip, signIn } from './helpers';

test.beforeEach(resetEmulators);

test('registro manual simple: 10.00 entre 3 desde el inicio del viaje', async ({ browser }) => {
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);

  await expect(page.getByRole('button', { name: /Escanear factura/ })).toBeDisabled();
  const started = Date.now();
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
  await expect(page.getByText('USD').first()).toBeVisible();

  await page.getByLabel('Descripción').fill('Cena');
  await page.getByLabel('Importe total').fill('10,00');
  await page.getByLabel('Categoría').selectOption({ label: 'Comida' });
  await expect(page.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Cuadra');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
  console.log(`SC-001 automated flow: ${Date.now() - started} ms`);
  const balances = page.getByRole('region', { name: 'Saldos' });
  await expect(balances).toContainText('6,66');
  await expect(balances).toContainText('3,33');
});

test('fecha fuera del rango del viaje se acepta', async ({ browser }) => {
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill('Pasaje reservado antes');
  await page.getByLabel('Importe total').fill('120');
  await page.getByLabel('Fecha de la transacción').fill('2026-06-15');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
});

test('un viaje pendiente no permite registrar gastos y lo explica', async ({ page }) => {
  await signIn(page, ANA.email, ANA.name);
  await page.getByRole('link', { name: 'Nuevo viaje' }).click();
  await page.getByLabel('Nombre del viaje').fill('Pendiente');
  await page.getByLabel('Fecha de inicio').fill('2026-11-01');
  await page.getByLabel('Fecha de fin').fill('2026-11-02');
  await page.getByLabel('Invitar por correo').fill(PEDRO.email);
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { name: 'Pendiente' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Registro manual' })).toHaveCount(0);
  await expect(page.getByText(/Registro manual disponible cuando todos acepten/)).toBeVisible();
});
