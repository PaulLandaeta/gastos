import { expect, test } from '@playwright/test';
import { ANA, PEDRO, resetEmulators, setupActiveTrip, openTab } from './helpers';

test.beforeEach(resetEmulators);

test('PRD: pago pendiente no afecta saldos; confirmar, rechazar con motivo y pagar desde la propuesta', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO]);
  const pedro = pages[PEDRO.email]!;

  // Pedro pays a personal item of Ana → Ana owes Pedro 20.00.
  await pedro.getByRole('link', { name: 'Registro manual' }).click();
  await pedro.getByLabel('Descripción').fill('Champú de Ana');
  await pedro.getByLabel('Importe total').fill('20');
  await pedro.getByRole('group', { name: '¿Entre quiénes?' }).getByRole('button', { name: 'Pedro', exact: true }).click();
  await pedro.getByLabel(/Gasto personal/).check();
  await pedro.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(pedro.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await ana.reload();
  await openTab(ana, 'Saldos');
  const balances = ana.getByRole('region', { name: 'Saldos' });
  await expect(balances).toContainText('debe 20,00');

  const started = Date.now();
  await balances.getByRole('link', { name: /Pagar 20,00/ }).click();
  await expect(ana.getByLabel('Importe pagado')).toHaveValue('20,00');
  await ana.getByLabel('Importe pagado').fill('10');
  await ana.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(ana.getByRole('status').filter({ hasText: 'pendiente de confirmación' })).toBeVisible();
  console.log(`SC-006 pay from proposal: ${Date.now() - started} ms`);
  await openTab(ana, 'Saldos');
  const payments = ana.getByRole('region', { name: 'Pagos' });
  await expect(payments).toContainText('Pendiente');
  await expect(balances).toContainText('debe 20,00');

  await pedro.reload();
  await openTab(pedro, 'Saldos');
  const pedroPayments = pedro.getByRole('region', { name: 'Pagos' });
  await expect(pedroPayments).toContainText('1 pago por confirmar');
  await pedroPayments.getByRole('button', { name: 'Confirmar' }).click();
  await expect(balances).toContainText('debe 10,00');

  // A second payment rejected with a reason.
  await openTab(ana, 'Saldos');
  await ana.getByRole('link', { name: 'Registrar pago' }).click();
  await ana.getByLabel('¿A quién pagaste?').selectOption({ label: 'Pedro' });
  await ana.getByLabel('Importe pagado').fill('5');
  await ana.getByRole('button', { name: 'Registrar pago' }).click();
  await pedroPayments.getByRole('button', { name: 'Rechazar' }).click();
  await pedroPayments.getByLabel('Motivo (opcional)').fill('No lo recibí');
  await pedroPayments.getByRole('button', { name: 'Confirmar rechazo' }).click();
  await expect(payments).toContainText('Rechazado');
  await expect(payments).toContainText('No lo recibí');
  await expect(balances).toContainText('debe 10,00');

  await payments.getByRole('tab', { name: 'Confirmados' }).click();
  await expect(payments.getByRole('listitem')).toHaveCount(1);
});
