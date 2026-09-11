import type { Page } from '@playwright/test';

import { RUN_REQUEST_STATE, serveRunPage, serveRunRequestState } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

async function stubAnalyzer(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
}

async function open(page: Page, suffix = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${ADDRESS}${suffix}`);
}

test('restores the old cluster request-state stack and cursor', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, '&t=256000');

  const card = page.getByTestId('request-state-run');
  await expect(card).toContainText('Request state');
  await expect(card).toContainText('3 categories · legend toggles each layer');
  await expect(card).toContainText('Click a legend item to show or hide that category.');
  await expect(card.getByText('iter', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Expand Request state' }).click();
  await expect(page.getByRole('dialog')).toContainText('Request state');
});

test('restores the old pool aggregate, average, and worker chart', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, '&at=pool:decode');

  const card = page.getByTestId('request-state-pool-decode');
  await expect(card).toContainText('Request state · decode');
  await expect(card).toContainText('2 workers · aggregate + average + workers');
  await expect(card).toContainText('pool aggregate · worker average · individual workers');
  await expect(card.getByText('pool aggregate', { exact: true })).toBeVisible();
  await expect(card.getByText('worker average', { exact: true })).toBeVisible();
  await expect(page.getByTestId('request-state-run')).toHaveCount(0);
});

test('restores the old selected-worker category chart', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, '&at=pool:decode.worker:1');

  const card = page.getByTestId('request-state-worker-decode-1');
  await expect(card).toContainText('decode / 1 · 3 categories');
  await expect(card).toContainText('Click a legend item to show or hide that category.');
  await expect(card.getByText('pending', { exact: true })).toBeVisible();
  await expect(card.getByText('active', { exact: true })).toBeVisible();
  await expect(card.getByText('done', { exact: true })).toBeVisible();
  await expect(page.getByTestId('request-state-pool-decode')).toHaveCount(0);
});

test('keeps an unavailable timeline in the old chart card', async ({ page }) => {
  await stubAnalyzer(page);
  await serveRunRequestState(page, RUN_REQUEST_STATE, {
    schema_version: 1,
    meta: {
      log_dir: 'logs/20260907_0_llama3_h200_throughput',
      available: false,
      reason: 'io.log_stage_transitions was not enabled for this run',
    },
    t_start_ms: [],
    t_end_ms: [],
    cluster_series: [],
    pools: [],
  });
  await open(page);

  const card = page.getByTestId('request-state-run');
  await expect(card).toContainText('io.log_stage_transitions');
  await expect(card.locator('div[role="img"]')).toHaveCount(0);
});
