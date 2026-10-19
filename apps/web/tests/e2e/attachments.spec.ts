import { expect, test, type Page } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip, openTab, choose } from './helpers';

test.beforeEach(resetEmulators);

const img = (name: string, text: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(text) });
const PDF = {
  name: 'factura.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj <</Type /Pages /Count 3>>\n2 0 obj <</Type /Page>>\n3 0 obj <</Type /Page>>\n4 0 obj <</Type /Page>>\n%%EOF'),
};

async function chooseBeneficiaries(page: Page, names: string[]) {
  const chips = page.getByRole('group', { name: '¿Entre quiénes?' });
  for (const name of ['Ana', 'Pedro', 'Juan']) {
    const button = chips.getByRole('button', { name, exact: true });
    const pressed = (await button.getAttribute('aria-pressed')) === 'true';
    if (pressed !== names.includes(name)) await button.click();
  }
}

test('US2: receipts on an expense are private, deduplicated and downloadable; payment proof', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  const juan = pages[JUAN.email]!;

  // Pedro registers a dinner with two photos and a 3-page PDF.
  await pedro.getByRole('link', { name: 'Registro manual' }).click();
  await pedro.getByLabel('Descripción').fill('Cena');
  await pedro.getByLabel('Importe total').fill('30');
  await chooseBeneficiaries(pedro, ['Ana', 'Pedro']);
  await pedro.getByTestId('attachment-input').setInputFiles([img('ticket-1.jpg', 'foto uno'), img('ticket-2.jpg', 'foto dos'), PDF]);
  const pending = pedro.getByRole('region', { name: 'Comprobantes' });
  await expect(pending.getByText('factura.pdf').first()).toBeVisible();
  await expect(pending.getByRole('listitem')).toHaveCount(3);
  await pedro.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(pedro.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await pedro.getByRole('tab', { name: 'Gastos' }).click();
  await pedro.getByRole('link', { name: /Cena/ }).click();
  const receipts = pedro.getByRole('region', { name: 'Comprobantes' });
  await expect(receipts.getByRole('listitem')).toHaveCount(3);
  await expect(receipts.getByText(/3 pág\./)).toBeVisible();
  const expenseUrl = pedro.url();

  // Opening a receipt goes through a short-lived signed URL.
  const [popup] = await Promise.all([pedro.waitForEvent('popup'), receipts.getByRole('button', { name: 'Abrir ticket-1.jpg' }).click()]);
  await popup.waitForURL(/local-blobs/);
  // The bytes are not a real JPEG: check the content through the same signed URL.
  expect(await (await pedro.request.get(popup.url())).text()).toBe('foto uno');
  await popup.close();

  // Same content again → duplicate warning, still three receipts.
  await receipts.getByTestId('attachment-input').setInputFiles([img('otra-vez.jpg', 'foto uno')]);
  await expect(receipts.getByText('Ese archivo ya está adjunto.')).toBeVisible();
  await expect(receipts.getByRole('listitem')).toHaveCount(3);

  // Juan is not involved: the expense and its receipts are not found.
  await juan.goto(expenseUrl);
  await expect(juan.getByRole('heading', { name: 'No encontrado' })).toBeVisible();
  await expect(juan.getByText('ticket-1.jpg')).toHaveCount(0);

  // Ana pays Pedro with a proof; Pedro (receiver) can open it, Juan cannot see it.
  await openTab(ana, 'Saldos');
  await ana.getByRole('link', { name: 'Registrar pago' }).click();
  await choose(ana, '¿A quién pagaste?', 'Pedro');
  await ana.getByLabel('Importe pagado').fill('15');
  await ana.getByLabel('Comprobante (opcional)').setInputFiles([img('transferencia.jpg', 'captura banco')]);
  await ana.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(ana.getByText(/Pago registrado/)).toBeVisible();

  await pedro.goto(expenseUrl.replace(/\/expenses\/.+$/, ''));
  await openTab(pedro, 'Saldos');
  await pedro.getByRole('button', { name: 'Comprobante de pago (1)' }).click();
  await expect(pedro.getByRole('button', { name: 'Abrir transferencia.jpg' })).toBeVisible();
  await juan.goto(expenseUrl.replace(/\/expenses\/.+$/, ''));
  await openTab(juan, 'Saldos');
  await expect(juan.getByRole('heading', { name: 'Pagos' })).toBeVisible();
  await expect(juan.getByRole('button', { name: /Comprobante de pago/ })).toHaveCount(0);
});
