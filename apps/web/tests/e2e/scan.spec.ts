import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

const photo = (name: string, text: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(text) });

test('US1: consent → scan → prefilled form with highlights and currency warning → saved as scanned', async ({ browser }) => {
  const { page: ana } = await setupActiveTrip(browser, ANA, [PEDRO]);

  await ana.getByRole('link', { name: /Escanear factura/ }).click();
  const dialog = ana.getByRole('dialog', { name: 'Antes de escanear' });
  await expect(dialog).toContainText('puede conservarlas hasta 30 días');
  await dialog.getByRole('button', { name: 'Acepto' }).click();
  await expect(ana.getByTestId('scan-quota')).toHaveText('Quedan 20 escaneos hoy en este viaje.');

  await ana.getByTestId('scan-input').setInputFiles([photo('ticket.jpg', 'ticket super ahorro')]);
  await expect(ana.getByRole('heading', { name: 'Revisar factura escaneada' })).toBeVisible();
  await expect(ana.getByLabel('Descripción')).toHaveValue('Super Ahorro');
  await expect(ana.getByRole('alert').filter({ hasText: 'parece estar en EUR' })).toBeVisible();
  await expect(ana.getByText('Revisa estos datos dudosos: «Agua».')).toBeVisible();
  const agua = ana.getByRole('group', { name: 'Ítem 2' });
  await expect(agua.getByText('Revisar', { exact: true })).toBeVisible();
  await expect(ana.getByText('ticket.jpg (escaneado)').first()).toBeVisible();

  // Total 9,90 = 6 + 3 + 0,90 tax: balanced, can save.
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await ana.getByRole('tab', { name: 'Gastos' }).click();
  await ana.getByRole('link', { name: /Super Ahorro/ }).click();
  await expect(ana.getByText('Escaneado', { exact: true })).toBeVisible();
  await expect(ana.getByRole('region', { name: 'Comprobantes' }).getByRole('button', { name: 'Abrir ticket.jpg' })).toBeVisible();
});

test('US1: AI failure offers manual registration keeping the photo', async ({ browser }) => {
  const { page: ana } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await ana.getByRole('link', { name: /Escanear factura/ }).click();
  await ana.getByRole('button', { name: 'Acepto' }).click();
  await ana.getByTestId('scan-input').setInputFiles([photo('borrosa.jpg', 'FAIL blurry')]);
  await expect(ana.getByText('El escaneo no está disponible ahora')).toBeVisible();
  await ana.getByRole('link', { name: 'Registrar a mano con la foto adjunta' }).click();
  await expect(ana.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
  await expect(ana.getByText('borrosa.jpg').first()).toBeVisible();
  await ana.getByLabel('Descripción').fill('Mercado');
  await ana.getByLabel('Importe total').fill('12');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
});
