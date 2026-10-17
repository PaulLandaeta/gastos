import { expect, test } from '@playwright/test';
import { resetEmulators, signIn, openTab } from './helpers';

test.beforeEach(resetEmulators);

test('Ana promueve a Pedro a admin; Pedro no ve controles de roles', async ({ browser }) => {
  const anaCtx = await browser.newContext();
  const ana = await anaCtx.newPage();
  await signIn(ana, 'ana@example.com', 'Ana');
  await ana.getByRole('link', { name: 'Nuevo viaje' }).click();
  await ana.getByLabel('Nombre del viaje').fill('Lima');
  await ana.getByLabel('Fecha de inicio').fill('2026-12-01');
  await ana.getByLabel('Fecha de fin').fill('2026-12-03');
  await ana.getByLabel('Invitar por correo').fill('pedro@example.com');
  await ana.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(ana.getByRole('heading', { name: 'Lima' })).toBeVisible();

  const pedroCtx = await browser.newContext();
  const pedro = await pedroCtx.newPage();
  await signIn(pedro, 'pedro@example.com', 'Pedro');
  await pedro.getByRole('region', { name: 'Invitaciones' }).getByRole('button', { name: 'Aceptar' }).click();
  await pedro.getByRole('link', { name: /Lima/ }).click();
  await expect(pedro.getByRole('heading', { name: 'Lima' })).toBeVisible();

  await openTab(ana, 'Resumen');
  await ana.getByRole('button', { name: 'Hacer admin a Pedro' }).click();
  await openTab(ana, 'Resumen');
  await expect(ana.getByRole('button', { name: 'Quitar admin a Pedro' })).toBeVisible();

  await openTab(pedro, 'Resumen');
  await expect(pedro.getByText('Admin', { exact: false }).first()).toBeVisible();
  await expect(pedro.getByRole('button', { name: /Hacer admin|Quitar admin/ })).toHaveCount(0);
  await anaCtx.close();
  await pedroCtx.close();
});
