import type { Page } from '@playwright/test';

import { RUN_KV_OCCUPANCY, serveRunKvOccupancy, serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;
const CHART_NAME = /KV occupancy\. Per-worker active KV-cache occupancy over time/;

async function stubAnalyzer(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
}

async function open(page: Page, hash: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('keeps KV out of the cluster stage, as in the old UI', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, ADDRESS);

  await expect(page.getByRole('img', { name: CHART_NAME })).toHaveCount(0);
  await expect(page.locator('[data-testid^="kv-"]')).toHaveCount(0);
});

test('reproduces the old pool KV card with worker shadows and a bold average', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode`);

  const panel = page.getByTestId('kv-pool-decode');
  await expect(panel).toContainText(/b\s*KV occupancy/);
  await expect(panel).toContainText('2 workers · pool: decode');
  await expect(panel).toContainText('scoped to decode pool; bold line is the pool average');
  await expect(panel.getByRole('img', { name: CHART_NAME })).toBeVisible();

  const utilization = await page.getByTestId('utilization-pool-decode').boundingBox();
  const memory = await panel.boundingBox();
  const batch = await page.getByTestId('batch-pool-decode').boundingBox();
  const queue = await page.getByTestId('request-state-pool-decode').boundingBox();
  const kernel = await page.getByTestId('kernel-time-pool-decode').boundingBox();
  expect(utilization).not.toBeNull();
  expect(memory).not.toBeNull();
  expect(batch).not.toBeNull();
  expect(queue).not.toBeNull();
  expect(kernel).not.toBeNull();
  expect(Math.abs(utilization!.y - memory!.y)).toBeLessThan(2);
  expect(memory!.x).toBeGreaterThan(utilization!.x + utilization!.width - 2);
  expect(batch!.y).toBeGreaterThan(
    Math.max(utilization!.y + utilization!.height, memory!.y + memory!.height),
  );
  expect(queue!.y).toBeGreaterThan(batch!.y);
  expect(kernel!.y).toBeGreaterThan(queue!.y);
});

test('reproduces the old selected-worker KV card and expand interaction', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode.worker:1&t=128057.775`);

  const panel = page.getByTestId('kv-worker-decode-1');
  await expect(panel).toContainText('worker: decode/1');
  await expect(panel).toContainText('selected worker only');
  await expect(panel.getByText('iter', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Expand KV occupancy' }).click();
  await expect(page.getByRole('dialog')).toContainText('KV occupancy');
  await expect(page.getByTestId('kv-pool-decode')).toHaveCount(0);
});

test('keeps an unavailable KV payload in the old chart card', async ({ page }) => {
  await stubAnalyzer(page);
  await serveRunKvOccupancy(page, RUN_KV_OCCUPANCY, {
    schema_version: 1,
    meta: { log_dir: 'logs/x', available: false, reason: 'kv_snapshot/ dir not found' },
    t_start_ms: [],
    t_end_ms: [],
    series: [],
  });
  await open(page, `${ADDRESS}&at=pool:decode`);

  await expect(page.getByText(/kv_snapshot\/ dir not found/)).toBeVisible();
  await expect(page.getByRole('img', { name: CHART_NAME })).toHaveCount(0);
});
