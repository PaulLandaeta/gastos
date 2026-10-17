import { expect, test } from '@playwright/test';
import { ANA, resetEmulators, setupActiveTrip, openTab } from './helpers';
import { getDoc, seedExpenses } from './seed';

test.beforeEach(resetEmulators);

test('SC-008: con 1.000 gastos, primera página de la lista y dashboard en menos de 3 s', async ({ browser }) => {
  const { page, tripUrl } = await setupActiveTrip(browser, ANA, [], 'Volumen');
  const tripId = tripUrl.split('/trips/')[1]!;
  const trip = (await getDoc(`trips/${tripId}`)) as { fields: { creatorUid: { stringValue: string } } };
  await seedExpenses(tripId, trip.fields.creatorUid.stringValue, 1000);

  let t0 = Date.now();
  await page.goto(tripUrl);
  await openTab(page, 'Resumen');
  await expect(page.getByRole('region', { name: 'Resumen del viaje' })).toContainText('10.000,00');
  const dashboardMs = Date.now() - t0;

  t0 = Date.now();
  await page.goto(`${tripUrl}/expenses`);
  await expect(page.getByRole('link', { name: /Gasto \d+/ })).toHaveCount(50);
  await expect(page.getByRole('button', { name: 'Cargar más' })).toBeVisible();
  const listMs = Date.now() - t0;

  console.log(JSON.stringify({ dashboardMs, listMs }));
  expect(dashboardMs).toBeLessThan(3000);
  expect(listMs).toBeLessThan(3000);
});
