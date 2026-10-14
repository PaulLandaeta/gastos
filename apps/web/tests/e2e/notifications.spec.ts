import { expect, test, type Page } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

async function addExpense(page: Page, description: string, amount: string, without?: string) {
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill(description);
  await page.getByLabel('Importe total').fill(amount);
  if (without) await page.getByRole('button', { name: without, pressed: true }).first().click();
  await expect(page.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Cuadra');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
}

test('US3: Juan solo recibe lo que puede ver, navega al gasto y gestiona leídas', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const juan = pages[JUAN.email]!;
  await expect(juan.getByRole('link', { name: 'Notificaciones' })).toBeVisible();

  await addExpense(ana, 'Cena', '30,00');
  await addExpense(ana, 'Regalo sorpresa', '20,00', 'Juan'); // private: Juan is not part of it

  // SC-006: visible in < 10 s with the app open; exactly one (RF-38).
  const bell = juan.getByRole('link', { name: '1 notificaciones sin leer' });
  await expect(bell).toBeVisible({ timeout: 10_000 });
  await bell.click();
  const list = juan.getByRole('list', { name: 'Notificaciones' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Ana registró un gasto en Uyuni');
  await expect(list).toContainText('Cena');
  await expect(list).not.toContainText('Regalo');

  // Opening it navigates to the expense and marks it read.
  await list.getByRole('button', { name: /^(No leída: )?Ana registró un gasto/ }).click();
  await expect(juan.getByRole('heading', { name: 'Cena' })).toBeVisible();
  await expect(juan.getByRole('link', { name: 'Notificaciones', exact: true })).toBeVisible();

  // Unread again, then «mark all».
  await juan.getByRole('link', { name: 'Notificaciones', exact: true }).click();
  await juan.getByRole('button', { name: /Marcar como no leída/ }).click();
  await expect(juan.getByRole('link', { name: '1 notificaciones sin leer' })).toBeVisible();
  await juan.getByRole('button', { name: 'Marcar todas como leídas' }).click();
  await expect(juan.getByRole('link', { name: 'Notificaciones', exact: true })).toBeVisible();

  // Ana removes Juan from «Cena»: he is told without details, and the old link is «no longer available».
  await ana.getByRole('link', { name: 'Ver gastos' }).click();
  await ana.getByRole('link', { name: /^Cena/ }).click();
  await ana.getByRole('link', { name: 'Editar gasto' }).click();
  await ana.getByRole('button', { name: 'Juan', pressed: true }).first().click();
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('heading', { name: 'Cena' })).toBeVisible();

  await expect(juan.getByRole('link', { name: '1 notificaciones sin leer' })).toBeVisible({ timeout: 10_000 });
  await expect(list).toContainText('Ya no participas en un gasto de Uyuni');
  await list.getByRole('button', { name: /^(No leída: )?Ana registró un gasto/ }).click();
  await expect(juan.getByText('Este elemento ya no está disponible o no tienes acceso.')).toBeVisible();
});
