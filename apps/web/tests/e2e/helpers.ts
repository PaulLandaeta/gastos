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
