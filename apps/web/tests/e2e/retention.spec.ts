import { expect, test, type Page } from '@playwright/test';
import { ANA, JUAN, PEDRO, PROJECT, resetEmulators, setupActiveTrip } from './helpers';

test.beforeEach(resetEmulators);

const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };

/** Moves every receipt of the expense to expire in `days` days (emulator admin REST). */
async function expireIn(expensePath: string, days: number) {
  const list = (await (await fetch(`${DOCS}/${expensePath}/attachments`, { headers: owner })).json()) as { documents: { name: string }[] };
  const when = new Date(Date.now() + days * 86_400_000).toISOString();
  for (const d of list.documents) {
    const res = await fetch(`http://127.0.0.1:8080/v1/${d.name}?updateMask.fieldPaths=expiresAt`, {
      method: 'PATCH',
      headers: owner,
      body: JSON.stringify({ fields: { expiresAt: { timestampValue: when } } }),
    });
    expect(res.ok).toBe(true);
  }
}

async function register(page: Page) {
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill('Hotel');
  await page.getByLabel('Importe total').fill('80');
  const chips = page.getByRole('group', { name: '¿Entre quiénes?' });
  await chips.getByRole('button', { name: 'Juan', exact: true }).click();
  await page.getByTestId('attachment-input').setInputFiles([{ name: 'reserva.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('reserva') }]);
  await expect(page.getByText('📎 reserva.jpg')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
}

test('US4: expiry notice for viewers only; after retention the expense shows the deletion', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  const juan = pages[JUAN.email]!;
  await register(pedro); // Ana and Pedro share it; Juan is not involved.

  await pedro.getByRole('link', { name: 'Ver gastos' }).click();
  await pedro.getByRole('link', { name: /Hotel/ }).click();
  const expenseUrl = pedro.url();
  const [, tripId, expenseId] = /trips\/([^/]+)\/expenses\/([^/?#]+)/.exec(expenseUrl)!;
  await expireIn(`trips/${tripId}/expenses/${expenseId}`, 10);

  await ana.reload();
  const notice = ana.getByRole('region', { name: 'Comprobantes por vencer' });
  await expect(notice).toContainText('reserva.jpg');
  await juan.reload();
  await expect(juan.getByRole('heading', { name: 'Pagos' })).toBeVisible();
  await expect(juan.getByRole('region', { name: 'Comprobantes por vencer' })).toHaveCount(0);

  await pedro.reload();
  await expect(pedro.getByText(/Se eliminará el .* por política de retención/)).toBeVisible();

  const later = new Date(Date.now() + 11 * 86_400_000).toISOString();
  const run = await fetch(`http://localhost:8787/local-admin/run-retention?now=${encodeURIComponent(later)}`, { method: 'POST' });
  expect(await run.json()).toMatchObject({ expired: 1 });
  await pedro.reload();
  await expect(pedro.getByText('reserva.jpg: comprobante eliminado por política de retención')).toBeVisible();
  await expect(pedro.getByRole('heading', { name: 'Hotel' })).toBeVisible();
});
