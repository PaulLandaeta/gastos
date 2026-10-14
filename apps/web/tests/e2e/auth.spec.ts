import { expect, test } from '@playwright/test';
import { resetEmulators, signIn } from './helpers';

test.beforeEach(resetEmulators);

test('login → perfil visible → logout → ruta protegida redirige a /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: /Continuar con Google/ })).toBeVisible();

  await signIn(page, 'ana@example.com', 'Ana Pérez');
  await page.getByRole('button', { name: /Cuenta de Ana Pérez/ }).click();
  await expect(page.getByText('ana@example.com')).toBeVisible();

  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/trips/new');
  await expect(page).toHaveURL(/\/login/);
});
