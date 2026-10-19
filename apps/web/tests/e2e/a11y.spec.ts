import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetEmulators, signIn, openTab, pickDate } from './helpers';

test.beforeEach(resetEmulators);

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label} accessibility violations`).toEqual([]);
}

test('pantallas principales sin violaciones WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Continuar con Google/ })).toBeVisible();
  await expectNoViolations(page, 'login');

  await signIn(page, 'ana@example.com', 'Ana');
  await expectNoViolations(page, 'mis viajes (vacío)');

  await page.getByRole('link', { name: 'Nuevo viaje' }).click();
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByText('Escribe un nombre')).toBeVisible();
  await expectNoViolations(page, 'crear viaje con errores');

  await page.getByLabel('Nombre del viaje').fill('Sucre');
  await page.getByLabel('Fecha de inicio', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fecha de inicio' })).toBeVisible();
  await expectNoViolations(page, 'calendario');
  await page.keyboard.press('Escape');
  await page.getByLabel('Moneda', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Moneda' })).toBeVisible();
  await expectNoViolations(page, 'lista de opciones');
  await page.keyboard.press('Escape');
  await pickDate(page, 'Fecha de inicio', '2027-02-01');
  await pickDate(page, 'Fecha de fin', '2027-02-03');
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { name: 'Sucre' })).toBeVisible();
  await openTab(page, 'Saldos');
  await expect(page.getByRole('region', { name: 'Saldos' }).getByText('No hay deudas pendientes.')).toBeVisible();
  await expectNoViolations(page, 'detalle del viaje');

  await page.getByRole('button', { name: /Cuenta de Ana/ }).click();
  await expectNoViolations(page, 'menú de cuenta');
});

test('navegación por teclado: el formulario de nuevo viaje es operable sin ratón', async ({ page }) => {
  await signIn(page, 'ana@example.com', 'Ana');
  await page.getByRole('link', { name: 'Nuevo viaje' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Nuevo viaje' })).toBeVisible();
  await page.getByLabel('Nombre del viaje').focus();
  await page.keyboard.type('Tarija');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Fecha de inicio')).toBeFocused();
});

test('pantallas de gastos (002) sin violaciones WCAG 2.1 AA a 360 px', async ({ browser }) => {
  const { setupActiveTrip, ANA, PEDRO } = await import('./helpers');
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await page.setViewportSize({ width: 360, height: 780 });
  await expectNoViolations(page, 'inicio del viaje con dashboard');

  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByRole('radio', { name: 'Por ítems de la factura' }).click();
  await page.getByRole('button', { name: 'Añadir ítem' }).click();
  await page.getByLabel('Importe total').fill('abc');
  await expectNoViolations(page, 'formulario por ítems con errores');
  await page.getByLabel('Importe total').fill('20');
  await page.getByRole('radio', { name: 'Repartir el total' }).click();
  await page.getByLabel('Descripción').fill('Museo');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await page.getByRole('tab', { name: 'Gastos' }).click();
  await expectNoViolations(page, 'lista de gastos');
  await page.getByRole('link', { name: /Museo/ }).click();
  await expect(page.getByRole('heading', { name: 'Museo' })).toBeVisible();
  await expectNoViolations(page, 'detalle del gasto');

  await page.getByRole('link', { name: 'Volver a gastos' }).click();
  await openTab(page, 'Resumen');
  await page.getByRole('link', { name: 'Categorías' }).click();
  await expectNoViolations(page, 'categorías');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('pantallas de la fase 3 (pagos, edición, impacto, devolución) sin violaciones a 360 px', async ({ browser }) => {
  const { setupActiveTrip, ANA, PEDRO } = await import('./helpers');
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO]);
  const pedro = pages[PEDRO.email]!;
  await ana.setViewportSize({ width: 360, height: 780 });

  await ana.getByRole('link', { name: 'Registro manual' }).click();
  await ana.getByLabel('Descripción').fill('Cena');
  await ana.getByLabel('Importe total').fill('40');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await pedro.reload();
  await openTab(pedro, 'Saldos');
  await pedro.getByRole('region', { name: 'Saldos' }).getByRole('link', { name: /Pagar/ }).click();
  await expectNoViolations(pedro, 'registrar pago');
  await pedro.getByRole('button', { name: 'Registrar pago' }).click();
  await ana.reload();
  await expectNoViolations(ana, 'inicio con pagos pendientes');
  await openTab(ana, 'Saldos');
  await ana.getByRole('region', { name: 'Pagos' }).getByRole('button', { name: 'Confirmar' }).click();

  await ana.getByRole('tab', { name: 'Gastos' }).click();
  await ana.getByRole('link', { name: /Cena/ }).click();
  await ana.getByRole('button', { name: 'Registrar devolución de Cena' }).click();
  await expectNoViolations(ana, 'detalle con formulario de devolución');
  await ana.getByRole('link', { name: 'Editar gasto' }).click();
  await ana.getByLabel('Importe total').fill('50');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('region', { name: 'Impacto en saldos' })).toBeVisible();
  await expectNoViolations(ana, 'edición con previsualización de impacto');
  const overflow = await ana.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('pantallas de escaneo y adjuntos (004) sin violaciones WCAG 2.1 AA a 360 px', async ({ browser }) => {
  const { setupActiveTrip, ANA, PEDRO } = await import('./helpers');
  const { page } = await setupActiveTrip(browser, ANA, [PEDRO]);
  await page.setViewportSize({ width: 360, height: 780 });

  await page.getByRole('link', { name: /Escanear factura/ }).click();
  await expect(page.getByRole('dialog', { name: 'Antes de escanear' })).toBeVisible();
  await expectNoViolations(page, 'aviso de consentimiento');
  await page.getByRole('button', { name: 'Acepto' }).click();
  await expect(page.getByTestId('scan-quota')).toBeVisible();
  await expectNoViolations(page, 'pantalla de escaneo');

  await page.getByTestId('scan-input').setInputFiles([{ name: 'ticket.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('ticket') }]);
  await expect(page.getByRole('heading', { name: 'Revisar factura escaneada' })).toBeVisible();
  await expectNoViolations(page, 'formulario prellenado con campos dudosos');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  await page.getByRole('tab', { name: 'Gastos' }).click();
  await page.getByRole('link', { name: /Super Ahorro/ }).click();
  await expect(page.getByRole('region', { name: 'Comprobantes' }).getByRole('listitem')).toHaveCount(1);
  await expectNoViolations(page, 'lista de comprobantes');
});

test('pantallas de la Fase 5 sin violaciones WCAG 2.1 AA (pendientes, notificaciones, sin conexión, exportar)', async ({ browser }) => {
  const { setupActiveTrip, ANA, PEDRO } = await import('./helpers');
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO]);
  const pedro = pages[PEDRO.email]!;
  await openTab(ana, 'Resumen');
  await expect(ana.getByRole('region', { name: 'Exportar' })).toBeVisible();
  await expectNoViolations(ana, 'detalle con menú exportar');

  // Offline: status bar, a pending expense and the pending page.
  await ana.context().setOffline(true);
  await expect(ana.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
  await ana.getByRole('link', { name: 'Registro manual' }).click();
  await ana.getByLabel('Descripción').fill('Cena');
  await ana.getByLabel('Importe total').fill('10');
  await ana.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(ana.getByRole('status').filter({ hasText: '1 pendiente' })).toBeVisible();
  await expectNoViolations(ana, 'detalle sin conexión con pendiente');
  await ana.goto('/pending').catch(() => undefined); // dev server: no service worker offline
  await ana.context().setOffline(false);
  await ana.goto('/pending');
  await expect(ana.getByRole('heading', { name: 'Gastos pendientes' })).toBeVisible();
  await expectNoViolations(ana, 'pendientes');

  await expect(pedro.getByRole('link', { name: /notificaciones sin leer/ })).toBeVisible({ timeout: 15_000 });
  await expectNoViolations(pedro, 'cabecera con contador');
  await pedro.getByRole('link', { name: /notificaciones sin leer/ }).click();
  await expect(pedro.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
  await expectNoViolations(pedro, 'bandeja de notificaciones');
});

test('pantallas de la Fase 6 sin violaciones WCAG 2.1 AA (baja de cuenta, participante eliminado, pago en su nombre)', async ({ browser }) => {
  const { setupActiveTrip, ANA, PEDRO } = await import('./helpers');
  const { page: ana, pages, tripUrl } = await setupActiveTrip(browser, ANA, [PEDRO]);
  const pedro = pages[PEDRO.email]!;
  await pedro.setViewportSize({ width: 360, height: 780 });

  await pedro.getByRole('button', { name: /Cuenta de Pedro/ }).click();
  await expectNoViolations(pedro, 'menú de cuenta con borrar cuenta');
  await pedro.getByRole('menuitem', { name: 'Borrar mi cuenta' }).click();
  await expect(pedro.getByRole('list', { name: 'Viajes afectados' })).toBeVisible();
  await pedro.getByLabel('Escribe BORRAR para confirmar').fill('BOR');
  await expectNoViolations(pedro, 'borrar cuenta');
  await pedro.getByLabel('Escribe BORRAR para confirmar').fill('BORRAR');
  await pedro.getByRole('button', { name: 'Borrar mi cuenta definitivamente' }).click();
  await expect(pedro.getByRole('status').filter({ hasText: 'Tu cuenta se eliminó' })).toBeVisible();
  await expectNoViolations(pedro, 'login tras la baja');

  await ana.goto(tripUrl);
  await openTab(ana, 'Resumen');
  await expect(ana.getByRole('region', { name: 'Participantes' }).getByText('Participante eliminado 1')).toBeVisible();
  await expectNoViolations(ana, 'viaje con participante eliminado');
  await openTab(ana, 'Saldos');
  await ana.getByRole('link', { name: 'Registrar pago' }).click();
  await expect(ana.getByLabel('¿Quién pagó?')).toBeVisible();
  await expectNoViolations(ana, 'registrar pago en nombre de un eliminado');
});
