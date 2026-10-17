import { expect, test } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip, signIn, openTab } from './helpers';

test.beforeEach(resetEmulators);

test('RF-56: Pedro borra su cuenta; los saldos del grupo no cambian y un gestor liquida con el eliminado', async ({ browser }) => {
  const { page: ana, pages, tripUrl } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  const juan = pages[JUAN.email]!;

  // Pedro pays 30,00 for the three of them: Ana and Juan owe him 10,00 each.
  await pedro.getByRole('link', { name: 'Registro manual' }).click();
  await pedro.getByLabel('Descripción').fill('Taxi');
  await pedro.getByLabel('Importe total').fill('30');
  await pedro.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(pedro.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  // Juan registers a payment to Pedro (pending): it blocks the deletion.
  await juan.goto(tripUrl);
  await openTab(juan, 'Saldos');
  await juan.getByRole('link', { name: 'Registrar pago' }).click();
  await juan.getByLabel('¿A quién pagaste?').selectOption({ label: 'Pedro' });
  await juan.getByLabel('Importe pagado').fill('10');
  await juan.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(juan.getByRole('status').filter({ hasText: 'pendiente de confirmación' })).toBeVisible();

  await pedro.getByRole('button', { name: /Cuenta de Pedro/ }).click();
  await pedro.getByRole('menuitem', { name: 'Borrar mi cuenta' }).click();
  await expect(pedro.getByRole('heading', { name: 'Borrar mi cuenta' })).toBeVisible();
  await expect(pedro.getByRole('alert')).toContainText('pagos pendientes');
  await expect(pedro.getByRole('list', { name: 'Viajes afectados' })).toContainText('1 pago pendiente');
  await expect(pedro.getByRole('button', { name: 'Borrar mi cuenta definitivamente' })).toBeDisabled();

  // Pedro confirms Juan's payment; now only Ana owes him 10,00.
  await pedro.goto(tripUrl);
  await openTab(pedro, 'Saldos');
  await pedro.getByRole('region', { name: 'Pagos' }).getByRole('button', { name: 'Confirmar' }).click();
  await openTab(pedro, 'Saldos');
  await expect(pedro.getByRole('region', { name: 'Saldos' })).toContainText('10,00');

  await pedro.goto('/account/delete');
  const affected = pedro.getByRole('list', { name: 'Viajes afectados' });
  await expect(affected).toContainText('Uyuni');
  await expect(affected).toContainText(/Te deben\s+10,00/);
  await pedro.getByLabel('Escribe BORRAR para confirmar').fill('BORRAR');
  await pedro.getByRole('button', { name: 'Borrar mi cuenta definitivamente' }).click();
  await expect(pedro.getByRole('status').filter({ hasText: 'Tu cuenta se eliminó' })).toBeVisible();

  // Ana sees the anonymous label with the same balance.
  await ana.reload();
  await openTab(ana, 'Resumen');
  await expect(ana.getByRole('region', { name: 'Participantes' }).getByText('Participante eliminado 1')).toBeVisible();
  await expect(ana.getByText('Pedro', { exact: true })).toHaveCount(0);
  await openTab(ana, 'Saldos');
  const balances = ana.getByRole('region', { name: 'Saldos' });
  await expect(balances).toContainText('Participante eliminado 1');
  await expect(balances).toContainText('10,00');

  // Ana (creator) pays the deleted participant and confirms it on their behalf.
  await openTab(ana, 'Saldos');
  await ana.getByRole('link', { name: 'Registrar pago' }).click();
  await ana.getByLabel('¿A quién pagaste?').selectOption({ label: 'Participante eliminado 1' });
  await ana.getByLabel('Importe pagado').fill('10');
  await ana.getByRole('button', { name: 'Registrar pago' }).click();
  await openTab(ana, 'Saldos');
  await ana.getByRole('region', { name: 'Pagos' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(balances.getByText('No hay deudas pendientes.')).toBeVisible();

  // Pedro signs in again with the same Google account: a brand-new user with no trips.
  await signIn(pedro, PEDRO.email, PEDRO.name);
  await expect(pedro.getByText('Uyuni')).toHaveCount(0);
});
