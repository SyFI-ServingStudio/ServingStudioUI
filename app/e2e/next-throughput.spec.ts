import type { Page } from '@playwright/test';

import { RUN_THROUGHPUT, serveRunPage, serveRunThroughput } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;
const CHART_NAME =
  /Throughput\. Total, prefill, and decode tokens per second over each analyzer interval/;

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

test('reproduces the existing throughput card and its three step-series', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  const chart = page.getByRole('img', { name: CHART_NAME });
  await expect(chart).toBeVisible();
  await expect(chart.getByText('total', { exact: true })).toBeVisible();
  await expect(chart.getByText('prefill', { exact: true })).toBeVisible();
  await expect(chart.getByText('decode', { exact: true })).toBeVisible();
  await expect(page.getByText('total ∥ prefill ∥ decode · tok/s', { exact: true })).toBeVisible();

  const card = page.getByTestId('throughput-run');
  await expect(card).toContainText(/b\s*Throughput/);
});

test('keeps the shared wall-clock cursor and expand interaction', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&t=204800`);

  const card = page.getByTestId('throughput-run');
  await expect(card.getByText('iter', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Expand Throughput' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Throughput');
  await expect(dialog.getByText('total', { exact: true })).toBeVisible();
});

test('closes an expanded chart when the result identity changes', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  await page.getByRole('button', { name: 'Expand Throughput' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '#/result/run/another-run?w=w_main';
  });
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('leaves the page when the old adaptive stage descends', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode.worker:1`);

  await expect(page.getByRole('img', { name: CHART_NAME })).toHaveCount(0);
  await expect(page.getByText('total ∥ prefill ∥ decode · tok/s', { exact: true })).toHaveCount(0);
});

test('keeps an unavailable payload in the chart card instead of drawing a flat line', async ({
  page,
}) => {
  await stubAnalyzer(page);
  await serveRunThroughput(page, RUN_THROUGHPUT, {
    schema_version: 1,
    meta: { log_dir: 'logs/x', available: false, reason: 'request_state.parquet not found' },
    t_start_ms: [],
    t_end_ms: [],
    series: [],
  });
  await open(page);

  await expect(page.getByText(/request_state\.parquet not found/)).toBeVisible();
  await expect(page.getByRole('img', { name: CHART_NAME })).toHaveCount(0);
});
