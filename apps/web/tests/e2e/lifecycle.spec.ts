import { expect, test } from '@playwright/test';
import { resetEmulators, signIn } from './helpers';

test.beforeEach(resetEmulators);

test('Pedro (admin) cierra el viaje; Ana lo archiva y lo restaura a cerrado', async ({ browser }) => {
  const anaCtx = await browser.newContext();
  const ana = await anaCtx.newPage();
  await signIn(ana, 'ana@example.com', 'Ana');
  await ana.getByRole('link', { name: 'Nuevo viaje' }).click();
  await ana.getByLabel('Nombre del viaje').fill('Cusco');
  await ana.getByLabel('Fecha de inicio').fill('2027-01-10');
  await ana.getByLabel('Fecha de fin').fill('2027-01-15');
  await ana.getByLabel('Invitar por correo').fill('pedro@example.com');
  await ana.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(ana.getByRole('heading', { name: 'Cusco' })).toBeVisible();

  const pedroCtx = await browser.newContext();
  const pedro = await pedroCtx.newPage();
  await signIn(pedro, 'pedro@example.com', 'Pedro');
  await pedro.getByRole('region', { name: 'Invitaciones' }).getByRole('button', { name: 'Aceptar' }).click();

  await ana.getByRole('button', { name: 'Hacer admin a Pedro' }).click();
  await expect(ana.getByRole('button', { name: 'Quitar admin a Pedro' })).toBeVisible();
  await expect(ana.getByRole('region', { name: 'Saldos' })).toBeVisible();

  await pedro.getByRole('link', { name: /Cusco/ }).click();
  await pedro.getByRole('button', { name: 'Cerrar viaje' }).click();
  await expect(pedro.getByText(/Este viaje está cerrado: solo lectura/)).toBeVisible();
  await expect(pedro.getByRole('button', { name: 'Archivar viaje' })).toHaveCount(0);

  await expect(ana.getByText('Cerrado', { exact: true })).toBeVisible();
  await ana.getByRole('button', { name: 'Archivar viaje' }).click();
  await expect(ana.getByText(/Este viaje está archivado/)).toBeVisible();

  await ana.getByRole('link', { name: 'Gastos de Viaje' }).click();
  await expect(ana.getByRole('link', { name: /Cusco/ })).toHaveCount(0);
  await ana.getByRole('button', { name: /Ver archivados/ }).click();
  await ana.getByRole('region', { name: 'Archivados' }).getByRole('link', { name: /Cusco/ }).click();
  await ana.getByRole('button', { name: 'Restaurar viaje' }).click();
  await expect(ana.getByText('Cerrado', { exact: true })).toBeVisible();
  await anaCtx.close();
  await pedroCtx.close();
});
