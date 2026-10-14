import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetEmulators, signIn } from './helpers';

test.beforeEach(resetEmulators);

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label} accessibility violations`).toEqual([]);
}

test('pantallas principales sin violaciones WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Continuar con Google/ })).toBeVisible();
  await expectNoViolations(page, 'login');

  await signIn(page, 'ana@example.com', 'Ana');
  await expectNoViolations(page, 'mis viajes (vacío)');

  await page.getByRole('link', { name: 'Nuevo viaje' }).click();
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByText('Escribe un nombre')).toBeVisible();
  await expectNoViolations(page, 'crear viaje con errores');

  await page.getByLabel('Nombre del viaje').fill('Sucre');
  await page.getByLabel('Fecha de inicio').fill('2027-02-01');
  await page.getByLabel('Fecha de fin').fill('2027-02-03');
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { name: 'Sucre' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saldos' }).getByText('No hay deudas pendientes.')).toBeVisible();
  await expectNoViolations(page, 'detalle del viaje');

  await page.getByRole('button', { name: /Cuenta de Ana/ }).click();
  await expectNoViolations(page, 'menú de cuenta');
});

test('navegación por teclado: el formulario de nuevo viaje es operable sin ratón', async ({ page }) => {
  await signIn(page, 'ana@example.com', 'Ana');
  await page.getByRole('link', { name: 'Nuevo viaje' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Nuevo viaje' })).toBeVisible();
  await page.getByLabel('Nombre del viaje').focus();
  await page.keyboard.type('Tarija');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Fecha de inicio')).toBeFocused();
});
