import { expect, test, type Page } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip, openTab } from './helpers';

test.beforeEach(resetEmulators);

async function register(page: Page, description: string, amount: string, beneficiaries: string[], personal = false) {
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill(description);
  await page.getByLabel('Importe total').fill(amount);
  const chips = page.getByRole('group', { name: '¿Entre quiénes?' });
  for (const name of ['Ana', 'Pedro', 'Juan']) {
    const button = chips.getByRole('button', { name, exact: true });
    const pressed = (await button.getAttribute('aria-pressed')) === 'true';
    if (pressed !== beneficiaries.includes(name)) await button.click();
  }
  if (personal) await page.getByLabel(/Gasto personal/).check();
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
}

test('PRD: usuario sin acceso al comprobante privado', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  const juan = pages[JUAN.email]!;

  await register(pedro, 'Taxi', '30', ['Ana', 'Pedro']);
  await register(ana, 'Champú', '12', ['Ana'], true);

  // Pedro opens the expense to get its URL.
  await pedro.getByRole('tab', { name: 'Gastos' }).click();
  await pedro.getByRole('link', { name: /Taxi/ }).click();
  await expect(pedro.getByRole('heading', { name: 'Taxi' })).toBeVisible();
  const taxiUrl = pedro.url();

  // Juan: not in his list, direct link → not found, balances visible.
  await juan.getByRole('tab', { name: 'Gastos' }).click();
  await expect(juan.getByRole('heading', { name: 'Gastos' })).toBeVisible();
  await expect(juan.getByText('Taxi')).toHaveCount(0);
  await juan.goto(taxiUrl);
  await expect(juan.getByRole('heading', { name: 'No encontrado' })).toBeVisible();
  await expect(juan.getByText('Taxi')).toHaveCount(0);
  await juan.goBack();
  await openTab(juan, 'Saldos');
  await expect(juan.getByRole('region', { name: 'Saldos' })).toBeVisible();

  // Ana's personal expense is absent from Pedro's views.
  await pedro.goto(taxiUrl.replace(/\/expenses\/.+$/, '/expenses'));
  await expect(pedro.getByText('Taxi')).toBeVisible();
  await expect(pedro.getByText('Champú')).toHaveCount(0);

  // Juan promoted to admin sees every expense; demoted, loses access immediately.
  await openTab(ana, 'Resumen');
  await ana.getByRole('button', { name: 'Hacer admin a Juan' }).click();
  await juan.goto(taxiUrl);
  await expect(juan.getByRole('heading', { name: 'Taxi' })).toBeVisible();
  await openTab(ana, 'Resumen');
  await ana.getByRole('button', { name: 'Quitar admin a Juan' }).click();
  await juan.goto(taxiUrl);
  await expect(juan.getByRole('heading', { name: 'No encontrado' })).toBeVisible();
});
