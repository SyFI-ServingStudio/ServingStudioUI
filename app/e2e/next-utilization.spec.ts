import type { Page } from '@playwright/test';

import { serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

async function stubAnalyzer(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
}

async function open(page: Page, hash = ADDRESS): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('reproduces the old cluster utilization card and all six timeline series', async ({
  page,
}) => {
  await stubAnalyzer(page);
  await open(page);

  const panel = page.getByTestId('utilization-run');
  await expect(panel).toContainText('cGPU utilization · all pools');
  await expect(panel).toContainText('4 worker lines · 2 pool averages');
  const chartContainer = panel.getByRole('img', { name: /GPU utilization · all pools/ });
  await expect(chartContainer).toBeVisible();

  const chart = chartContainer.locator('svg');
  await expect(chart).toBeVisible();
  const canvas = await chart.boundingBox();
  expect(canvas?.height).toBeGreaterThan(190);
});

test('keeps the old cursor and expand interaction', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&t=128057.775`);

  const panel = page.getByTestId('utilization-run');
  await panel.hover();
  await panel.getByRole('button', { name: 'Expand GPU utilization · all pools' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "GPU busy fraction over time for every worker; bold lines show each pool's average.",
  );
});

test('scopes the old chart to a pool without changing its visual card', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode`);

  const panel = page.getByTestId('utilization-pool-decode');
  await expect(panel).toContainText('aGPU utilization');
  await expect(panel).toContainText('2 workers · pool: decode');
  await expect(panel).toContainText('scoped to decode pool; bold line is the pool average');
  await expect(panel.getByRole('img', { name: /GPU utilization/ })).toBeVisible();
  await expect(page.getByTestId('utilization-run')).toHaveCount(0);
  await expect(page.locator('[data-testid^="utilization-worker-"]')).toHaveCount(0);
});

test('scopes the old chart to the selected worker', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode.worker:1`);

  const panel = page.getByTestId('utilization-worker-decode-1');
  await expect(panel).toContainText('aGPU utilization');
  await expect(panel).toContainText('worker: decode/1');
  await expect(panel).toContainText('selected worker only');
  await expect(panel.getByRole('img', { name: /GPU utilization/ })).toBeVisible();
  await expect(page.getByTestId('utilization-run')).toHaveCount(0);
  await expect(page.locator('[data-testid^="utilization-pool-"]')).toHaveCount(0);
});
