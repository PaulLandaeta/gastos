import { expect, type Page } from '@playwright/test';

export const PROJECT = 'demo-gastos';

/** Clears Auth and Firestore emulator data between specs. */
export async function resetEmulators(): Promise<void> {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/**
 * Signs in through the emulator-only test hook (window.__e2eSignIn), which uses a fake Google
 * credential accepted by the Auth Emulator. The hook does not exist in production builds.
 */
export async function signIn(page: Page, email: string, name: string): Promise<void> {
  await page.goto('/login');
  await page.waitForFunction(() => typeof (window as unknown as { __e2eSignIn?: unknown }).__e2eSignIn === 'function');
  await page.evaluate(
    ([e, n]) => (window as unknown as { __e2eSignIn: (e: string, n: string) => Promise<void> }).__e2eSignIn(e!, n!),
    [email, name],
  );
  await expect(page.getByRole('heading', { name: 'Mis viajes' })).toBeVisible();
}

export interface Person {
  email: string;
  name: string;
}

/**
 * Creates a trip as `creator` inviting `others`, and has every invitee accept in its own browser
 * context. Returns the creator page (on the trip detail) plus one page per invitee.
 */
export async function setupActiveTrip(
  browser: import('@playwright/test').Browser,
  creator: Person,
  others: Person[],
  tripName = 'Uyuni',
) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, creator.email, creator.name);
  await page.getByRole('link', { name: 'Nuevo viaje' }).click();
  await page.getByLabel('Nombre del viaje').fill(tripName);
  await page.getByLabel('Fecha de inicio').fill('2026-11-01');
  await page.getByLabel('Fecha de fin').fill('2026-11-05');
  if (others.length) await page.getByLabel('Invitar por correo').fill(others.map((o) => o.email).join(', '));
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { name: tripName })).toBeVisible();
  const tripUrl = page.url();

  const pages: Record<string, Page> = {};
  for (const o of others) {
    const c = await browser.newContext();
    const p = await c.newPage();
    await signIn(p, o.email, o.name);
    await p
      .getByRole('region', { name: 'Invitaciones' })
      .getByRole('listitem')
      .filter({ hasText: tripName })
      .getByRole('button', { name: 'Aceptar' })
      .click();
    await p.getByRole('link', { name: new RegExp(tripName) }).first().click();
    await expect(p.getByRole('heading', { name: tripName })).toBeVisible();
    pages[o.email] = p;
  }
  if (others.length) await expect(page.getByText('Activo', { exact: true })).toBeVisible();
  return { page, tripUrl, pages };
}

export const ANA = { email: 'ana@example.com', name: 'Ana' };
export const PEDRO = { email: 'pedro@example.com', name: 'Pedro' };
export const JUAN = { email: 'juan@example.com', name: 'Juan' };
