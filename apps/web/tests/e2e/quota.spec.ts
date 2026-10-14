import { expect, test } from '@playwright/test';
import { ANA, PEDRO, PROJECT, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

/** Lowers the trip quota to 1 through the `config/ai` override (emulator REST, admin bypass). */
async function setTripQuota(n: number) {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/config/ai`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { tripDay: { integerValue: String(n) } } }),
  });
  expect(res.ok).toBe(true);
}

test('US3: with the trip quota exhausted, scanning points to manual registration', async ({ browser }) => {
  await setTripQuota(1);
  const { page: ana } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await ana.getByRole('link', { name: /Escanear factura/ }).click();
  await ana.getByRole('button', { name: 'Acepto' }).click();
  await expect(ana.getByTestId('scan-quota')).toHaveText('Quedan 1 escaneos hoy en este viaje.');
  await ana.getByTestId('scan-input').setInputFiles([{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('first') }]);
  await expect(ana.getByRole('heading', { name: 'Revisar factura escaneada' })).toBeVisible();

  await ana.goBack();
  await ana.goBack();
  await expect(ana.getByText('Cuota agotada hoy')).toBeVisible();
  await ana.getByRole('link', { name: /Escanear factura/ }).click();
  await expect(ana.getByText('Cuota de escaneo agotada.')).toBeVisible();
  await ana.getByRole('link', { name: 'Registrar a mano' }).click();
  await expect(ana.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
});
