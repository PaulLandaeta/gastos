import { expect, test } from '@playwright/test';
import { formatReport, runSmoke } from '../../../../ops/src/smoke';
import { ANA, resetEmulators, signIn } from '../helpers';

test.beforeEach(resetEmulators);

test('FR-026: con la CSP del build se inicia sesión, se registra un gasto y se exporta sin bloqueos', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', (m) => {
    if (m.text().startsWith('CSP ') || /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  await page.goto('/login');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");

  await signIn(page, ANA.email, ANA.name);
  await page.getByRole('link', { name: 'Nuevo viaje' }).click();
  await page.getByLabel('Nombre del viaje').fill('Sucre');
  await page.getByLabel('Fecha de inicio').fill('2026-11-01');
  await page.getByLabel('Fecha de fin').fill('2026-11-03');
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { name: 'Sucre' })).toBeVisible();

  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill('Salteñas');
  await page.getByLabel('Importe total').fill('12');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();

  for (const name of ['Excel detallado', 'PDF resumen']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.(xlsx|pdf)$/);
  }
  expect(violations).toEqual([]);
});

test('FR-015: la verificación posterior al despliegue pasa contra el stack local', async () => {
  const report = await runSmoke({ appUrl: 'http://localhost:5181', apiUrl: 'http://localhost:8787' });
  expect(report.filter((c) => !c.ok), formatReport(report)).toEqual([]);
});
