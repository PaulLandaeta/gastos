import { expect, test } from '@playwright/test';
import { resetEmulators, signIn, pickDate, choose } from './helpers';

test.beforeEach(resetEmulators);

test('Ana crea un viaje con invitados; queda pendiente hasta que Pedro y Juan aceptan', async ({ browser }) => {
  const anaCtx = await browser.newContext();
  const ana = await anaCtx.newPage();
  await signIn(ana, 'ana@example.com', 'Ana');

  await ana.getByRole('link', { name: 'Nuevo viaje' }).click();
  await ana.getByLabel('Nombre del viaje').fill('Uyuni');
  await pickDate(ana, 'Fecha de inicio', '2026-11-01');
  await pickDate(ana, 'Fecha de fin', '2026-11-05');
  await choose(ana, 'Moneda', 'USD');
  await ana.getByLabel('Invitar por correo').fill('pedro@example.com, juan@example.com');
  await ana.getByRole('button', { name: 'Crear viaje' }).click();

  await expect(ana.getByRole('heading', { name: 'Uyuni' })).toBeVisible();
  await expect(ana.getByText('Pendiente', { exact: true })).toBeVisible();

  for (const [email, name] of [
    ['pedro@example.com', 'Pedro'],
    ['juan@example.com', 'Juan'],
  ] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, email, name);
    const invitation = page.getByRole('region', { name: 'Invitaciones' }).getByRole('listitem').filter({ hasText: 'Uyuni' });
    await invitation.getByRole('button', { name: 'Aceptar' }).click();
    await expect(page.getByRole('link', { name: /Uyuni/ })).toBeVisible();
    await ctx.close();
  }

  await expect(ana.getByText('Activo', { exact: true })).toBeVisible();
  await ana.getByRole('link', { name: 'Gastos de Viaje' }).click();
  await expect(ana.getByRole('region', { name: 'Activos' }).getByRole('link', { name: /Uyuni/ })).toBeVisible();
  await anaCtx.close();
});
