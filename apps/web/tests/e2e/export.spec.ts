import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import readExcelFile from 'read-excel-file/node';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip } from './helpers';
import { getDoc, seedExpenses } from './seed';

test.beforeEach(resetEmulators);

async function addExpense(page: Page, description: string, amount: string, without?: string) {
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill(description);
  await page.getByLabel('Importe total').fill(amount);
  if (without) await page.getByRole('button', { name: without, pressed: true }).first().click();
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
}

async function downloadExcel(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel detallado' }).click()]);
  const sheets = await readExcelFile(await readFile((await download.path())!));
  return { name: download.suggestedFilename(), sheets, text: JSON.stringify(sheets) };
}

test('US4: cada uno exporta lo que ve; los saldos coinciden con la app (SC-008)', async ({ browser }) => {
  const { page: ana, pages, tripUrl } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  await addExpense(ana, 'Taxi', '30,00');
  await addExpense(ana, 'Regalo sorpresa', '20,00', 'Pedro');

  await pedro.goto(tripUrl);
  const excel = await downloadExcel(pedro);
  expect(excel.name).toMatch(/^gastos-uyuni-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(excel.text).toContain('Taxi');
  expect(excel.text).not.toContain('Regalo');
  const saldos = excel.sheets.find((s) => s.sheet === 'Saldos')!.data;
  // Pedro consumed 10,00 of «Taxi» → his balance is −10,00, the same as the app shows.
  expect(saldos.find((r) => r[0] === 'Pedro')![3]).toBe(-10);
  await expect(pedro.getByRole('region', { name: 'Saldos' })).toContainText('10,00');

  const [pdf] = await Promise.all([pedro.waitForEvent('download'), pedro.getByRole('button', { name: 'PDF resumen' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await readFile((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  // The creator exports every expense.
  const all = await downloadExcel(ana);
  expect(all.text).toContain('Regalo sorpresa');
});

test('SC-007: un viaje de 1.000 gastos se exporta en menos de 30 s', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, tripUrl } = await setupActiveTrip(browser, ANA, [], 'Volumen');
  const tripId = tripUrl.split('/trips/')[1]!;
  const trip = (await getDoc(`trips/${tripId}`)) as { fields: { creatorUid: { stringValue: string } } };
  await seedExpenses(tripId, trip.fields.creatorUid.stringValue, 1000);
  await page.goto(tripUrl);
  const t0 = Date.now();
  const excel = await downloadExcel(page);
  const ms = Date.now() - t0;
  console.log(JSON.stringify({ exportMs: ms }));
  expect(ms).toBeLessThan(30_000);
  const rows = excel.sheets.find((s) => s.sheet === 'Gastos')!.data;
  expect(rows).toHaveLength(1 + 1000 + 1); // header + expenses + total
  expect(rows.at(-1)![5]).toBe(10_000);
});
