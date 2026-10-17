import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ANA, JUAN, PEDRO, resetEmulators, setupActiveTrip, openTab } from './helpers';

test.beforeEach(resetEmulators);

/** `payer` pays a personal item of `beneficiary` (everybody else is deselected). */
async function personalExpense(page: Page, description: string, amount: string, beneficiary: string, others: string[]) {
  await page.getByRole('link', { name: 'Registro manual' }).click();
  await page.getByLabel('Descripción').fill(description);
  await page.getByLabel('Importe total').fill(amount);
  const who = page.getByRole('group', { name: '¿Entre quiénes?' });
  for (const name of others) await who.getByRole('button', { name, exact: true }).click();
  await expect(who.getByRole('button', { name: beneficiary, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel(/Gasto personal/).check();
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
}

test('RF-57: modo picante — apagado por defecto, ranking, vistas directa/transitiva y solo gestores lo cambian', async ({ browser }) => {
  const { page: ana, pages } = await setupActiveTrip(browser, ANA, [PEDRO, JUAN]);
  const pedro = pages[PEDRO.email]!;
  const juan = pages[JUAN.email]!;

  // Ana owes Pedro 20 and Pedro owes Juan 30 → nets Ana −20, Pedro −10, Juan +30.
  await personalExpense(pedro, 'Champú de Ana', '20', 'Ana', ['Pedro', 'Juan']);
  await personalExpense(juan, 'Gorra de Pedro', '30', 'Pedro', ['Ana', 'Juan']);

  await pedro.reload();
  await openTab(pedro, 'Saldos');
  await expect(pedro.getByRole('region', { name: 'Saldos' })).toBeVisible();
  await openTab(pedro, 'Saldos');
  await expect(pedro.getByRole('region', { name: 'Ranking del grupo' })).toHaveCount(0);
  await openTab(pedro, 'Resumen');
  await expect(pedro.getByRole('button', { name: /Modo picante/ })).toHaveCount(0);

  await openTab(ana, 'Resumen');
  const toggle = ana.getByRole('button', { name: /Modo picante/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await pedro.reload();
  await openTab(pedro, 'Saldos');
  const ranking = pedro.getByRole('region', { name: 'Ranking del grupo' });
  await expect(ranking).toContainText('Ana es la más zorra del grupo: le debe 20,00');
  await expect(ranking).toContainText('Pedro es una señorita: solo le debe 10,00');
  await expect(ranking).toContainText('Juan es macho caporal: no le debe nada a nadie.');
  // Transitive (default): both debts end at Juan.
  await expect(ranking).toContainText('Ana es la zorra de Juan');

  await ranking.getByRole('button', { name: 'Directa' }).click();
  await expect(ranking).toContainText('Ana es la zorra de Pedro');
  await expect(ranking).toContainText('Pedro es la zorra de Juan');
  await expect(ranking).toContainText('La más zorra del grupo');

  const axe = await new AxeBuilder({ page: pedro })
    .include('section[aria-labelledby="roast-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await pedro.reload();
  await openTab(pedro, 'Saldos');
  await expect(pedro.getByRole('region', { name: 'Saldos' })).toBeVisible();
  await openTab(pedro, 'Saldos');
  await expect(pedro.getByRole('region', { name: 'Ranking del grupo' })).toHaveCount(0);
});
