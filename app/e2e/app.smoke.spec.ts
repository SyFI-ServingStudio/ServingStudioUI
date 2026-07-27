import {
  expectKernelShareSelectionStable,
  expectRenderedCharts,
  openRealRun,
  scopeToPool,
  scopeToWorker,
} from './helpers';
import { expect, test } from './quality.fixture';

test('loads the real analyzer folder and drills through a composite worker identity', async ({
  page,
}) => {
  await openRealRun(page);

  await expect(page.getByRole('heading', { name: 'Simulation overview', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trace overview', level: 3 })).toBeVisible();
  await expect(page.getByText('Trace distribution not generated', { exact: true })).toBeVisible();
  await expectRenderedCharts(page);

  const poolButton = page.getByRole('button', { name: 'Scope to pool attn' });
  await poolButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Pool · attn', level: 2 })).toBeVisible();

  await scopeToWorker(page, 'attn/0');
  await expectKernelShareSelectionStable(page);

  await page.getByRole('button', { name: 'Scope to whole deployment' }).click();
  await expect(page.getByRole('heading', { name: 'Cluster outcome', level: 2 })).toBeVisible();
});

test('uses one fully rounded aggregate return in the run masthead', async ({ page }) => {
  await openRealRun(page);

  const aggregateReturn = page.getByRole('link', { name: 'Return to aggregate overview' });
  await expect(aggregateReturn).toBeVisible();
  expect(
    await aggregateReturn.evaluate((element) => {
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
      return radius >= element.getBoundingClientRect().height / 2;
    }),
  ).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Analyzer workspace' })).toHaveCount(0);
  await expect(page.getByText('Current run', { exact: true })).toBeVisible();
});

test('opens the FFN pool through the same stable pool control', async ({ page }) => {
  await openRealRun(page);
  await scopeToPool(page, 'ffn');
  await expect(page.getByRole('button', { name: 'Scope to worker ffn/0' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scope to worker ffn/1' }).first()).toBeVisible();
  await scopeToWorker(page, 'ffn/0');
});

test('opens the launcher-defined sweep aggregate workspace', async ({ page }) => {
  await page.goto('/#/aggregate');
  await expect(page.getByRole('heading', { name: 'Sweep aggregate', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Throughput', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Request SLO', level: 3 })).toBeVisible();
  await expect(page.getByRole('img', { name: /Total throughput by request_rate/ })).toBeVisible();

  await page.getByRole('button', { name: 'unified' }).click();
  await expect(page.getByRole('listbox', { name: 'Experiments by date' })).toContainText(
    '0_llama3_8b_tp_rate',
  );
  await expect(page.getByText('1/2 shown', { exact: true })).toBeVisible();

  const scrollBeforeSelection = await page.evaluate(() => window.scrollY);
  await page.getByRole('option', { name: '20260727_0_llama3_8b_tp_rate' }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scrollBeforeSelection);
});

test('opens an unclaimed run through the singleton aggregate interface', async ({ page }) => {
  await page.goto('/#/aggregate');
  await page.getByRole('option', { name: /20260715_1_afd_ui_reanalysis/ }).click();

  await expect(page.getByText('54,635 tok/s', { exact: true })).toBeVisible();
  await expect(page.getByText('68.9 %', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /by request_rate/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect run →' }).click();
  await expect(page.getByRole('heading', { name: 'Simulation overview', level: 3 })).toBeVisible();
});
