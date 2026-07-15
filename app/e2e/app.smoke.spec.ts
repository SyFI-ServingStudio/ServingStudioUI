import { expectRenderedCharts, openRealRun, scopeToPool, scopeToWorker } from './helpers';
import { expect, test } from './quality.fixture';

test('loads the real analyzer folder and drills through a composite worker identity', async ({
  page,
}) => {
  await openRealRun(page);

  await expect(page.getByRole('heading', { name: 'Simulation overview', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trace overview', level: 2 })).toBeVisible();
  await expect(page.getByText('Trace distribution not generated', { exact: true })).toBeVisible();
  await expectRenderedCharts(page);

  const poolButton = page.getByRole('button', { name: 'Scope to pool attn' });
  await poolButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Pool · attn', level: 2 })).toBeVisible();

  await scopeToWorker(page, 'attn/0');

  await page.getByRole('button', { name: 'Scope to whole deployment' }).click();
  await expect(page.getByRole('heading', { name: 'Cluster outcome', level: 2 })).toBeVisible();
});

test('opens the FFN pool through the same stable pool control', async ({ page }) => {
  await openRealRun(page);
  await scopeToPool(page, 'ffn');
  await expect(page.getByRole('button', { name: 'Scope to worker ffn/0' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scope to worker ffn/1' }).first()).toBeVisible();
  await scopeToWorker(page, 'ffn/0');
});
