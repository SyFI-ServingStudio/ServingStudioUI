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

test('reproduces the old cluster kernel-time chart', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  const panel = page.getByTestId('kernel-time-run');
  await expect(panel).toContainText(/f\s*Cluster kernel time breakdown/);
  await expect(panel).toContainText('sampled family mix · exact totals');
  await expect(panel).toContainText('cluster 1,126,908.42 ms');
  await expect(panel).toContainText('prefill 512,231.1 ms');
  await expect(panel).toContainText('decode 614,677.32 ms');
  await expect(panel).toContainText(
    'worker-local regular iter_id stride · 217,143 / 1,000,000 worker rows replayed',
  );
  await expect(panel.getByText(/cluster · 1.13M ms/)).toBeVisible();
  await expect(panel.getByText(/prefill · 512.23K ms/)).toBeVisible();
  await expect(panel.getByText(/decode · 614.68K ms/)).toBeVisible();

  await panel.getByRole('button', { name: 'Expand Cluster kernel time breakdown' }).click();
  await expect(page.getByRole('dialog')).toContainText('Cluster kernel time breakdown');
});

test('reproduces the old one-row pool chart without worker navigation', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode`);

  const panel = page.getByTestId('kernel-time-pool-decode');
  await expect(panel).toContainText(/f\s*Kernel time breakdown · decode/);
  await expect(panel).toContainText('sampled family mix · exact totals');
  await expect(panel).toContainText('decode 614,677.32 ms');
  await expect(panel.getByText(/decode · 614.68K ms/)).toBeVisible();
  await expect(panel.locator('[data-testid^="kernel-time-child-"]')).toHaveCount(0);
  await expect(panel.getByRole('button')).toHaveCount(2);
  await expect(
    panel.getByRole('button', { name: 'Select Kernel time breakdown · decode panel' }),
  ).toBeVisible();
});

test('keeps request state immediately above kernel time', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode`);

  const queuePanel = page.getByTestId('request-state-pool-decode');
  const kernelPanel = page.getByTestId('kernel-time-pool-decode');
  await expect(queuePanel).toBeVisible();
  await expect(kernelPanel).toBeVisible();
  const queue = await queuePanel.boundingBox();
  const kernel = await kernelPanel.boundingBox();
  expect(queue).not.toBeNull();
  expect(kernel).not.toBeNull();
  expect(kernel!.y).toBeGreaterThan(queue!.y);
});

test('renders a missing pool in the old chart card', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:nope`);

  const panel = page.getByTestId('kernel-time-pool-nope');
  await expect(panel).toContainText('Kernel time breakdown · nope');
  await expect(panel).toContainText('This run has no pool named nope.');
  await expect(panel.getByRole('img')).toHaveCount(0);
});
