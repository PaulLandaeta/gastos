import { expect, type Page } from '@playwright/test';
import { PROJECT } from '../helpers';

/** Waits until the service worker is active, so an offline reload is served from the precache. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

export async function addSimpleExpense(page: Page, description: string, amount: string): Promise<void> {
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
  await page.getByLabel('Descripción').fill(description);
  await page.getByLabel('Importe total').fill(amount);
  await expect(page.getByRole('status', { name: 'Resumen del gasto' })).toContainText('Cuadra');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
}

export const statusBar = (page: Page) => page.getByRole('status').filter({ hasText: /Sin conexión|pendiente|atención/ });

/** Expenses stored in the emulator for a trip (admin read, bypasses Rules). */
export async function storedExpenses(tripId: string): Promise<{ description: string; totalMinor: number }[]> {
  const r = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/trips/${tripId}/expenses?pageSize=300`,
    { headers: { authorization: 'Bearer owner' } },
  );
  const json = (await r.json()) as { documents?: { fields: Record<string, { stringValue?: string; integerValue?: string }> }[] };
  return (json.documents ?? []).map((d) => ({
    description: d.fields['description']?.stringValue ?? '',
    totalMinor: Number(d.fields['totalMinor']?.integerValue ?? 0),
  }));
}

export const tripIdOf = (url: string) => new URL(url).pathname.split('/')[2]!;
