import type { Page, Route } from '@playwright/test';

import { expect, test } from './quality.fixture';

/**
 * The rebuilt application's first vertical slice, end to end.
 *
 * Served from the production entry and pointed at a stubbed Analyzer. What it
 * checks is the arrangement rather than
 * any particular data: an address alone is enough to render the page, the five
 * result catalogs and Agent job list are independent reads, and a kind that
 * cannot be read says so instead of vanishing.
 */

const UPDATED = '2026-09-01T10:00:00Z';

function catalog(key: string, rows: unknown[]) {
  return { protocol_version: 1, generated_at: UPDATED, [key]: rows };
}

const PREDICTIONS = catalog('predictions', [
  {
    workspace_id: 'w_main',
    prediction_id: 'p_llama3_h200_throughput',
    display_name: 'Llama3 H200 throughput',
    status: 'ready',
    selector: 'llama3_dense_tp',
    gpu: 'NVIDIA H200',
    case_count: 4,
    updated_at: UPDATED,
  },
  {
    workspace_id: 'w_main',
    prediction_id: 'p_spec5_necessary_work',
    display_name: 'Spec5 necessary work',
    status: 'running',
    selector: 'qwen3_moe_afd',
    gpu: 'NVIDIA H200',
    case_count: 2,
    updated_at: '2026-08-20T10:00:00Z',
  },
]);

const SWEEPS = catalog('sweeps', [
  {
    workspace_id: 'w_main',
    sweep_id: 's_tp_rate',
    display_name: 'TP × request rate',
    kind: 'sweep',
    axes: ['tensor_parallel', 'request_rate'],
    num_runs: 4,
    experiment_date: '2026-08-25',
    deployments: ['unified'],
    traces: ['sharegpt.csv'],
    status: 'ready',
    updated_at: '2026-08-25T10:00:00Z',
  },
]);

const EMPTY: Record<string, string> = {
  alignments: 'alignments',
  'kernel-profiles': 'kernel_profiles',
  'kernel-measurements': 'kernel_measurements',
};

/**
 * Stub the Analyzer's six catalog routes.
 *
 * `broken` names a route that answers 500, which is how the spec checks that
 * one unreadable kind does not empty the page.
 */
async function stubAnalyzer(page: Page, broken?: string): Promise<void> {
  const serve = (route: Route, body: unknown, path: string) =>
    path === broken ? route.fulfill({ status: 500, body: 'boom' }) : route.fulfill({ json: body });

  await page.route('**/api/analyzer/v1/sweeps', (route) => serve(route, SWEEPS, 'sweeps'));
  await page.route('**/api/analyzer/v1/predictions', (route) =>
    serve(route, PREDICTIONS, 'predictions'),
  );
  for (const [path, key] of Object.entries(EMPTY)) {
    await page.route(`**/api/analyzer/v1/${path}`, (route) => serve(route, catalog(key, []), path));
  }
  await page.route('**/api/agent/v1/workspaces', (route) =>
    route.fulfill({ json: { workspaces: [] } }),
  );
}

async function openCatalog(page: Page, hash = '#/results?w=w_main'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('renders the results catalog from the address alone', async ({ page }) => {
  await stubAnalyzer(page);
  await openCatalog(page);

  const catalog = page.getByRole('listbox', { name: 'Results, newest first' });
  await expect(catalog.getByRole('option', { name: /Llama3 H200 throughput/ })).toBeVisible();
  await expect(catalog.getByRole('option', { name: /TP × request rate/ })).toBeVisible();

  // Newest first, so the H200 prediction precedes the sweep and the older prediction.
  await expect
    .poll(() => catalog.getByRole('option').evaluateAll((rows) => rows.map((row) => row.ariaLabel)))
    .toEqual([
      'Open Timing prediction Llama3 H200 throughput · Ready',
      'Open Simulation TP × request rate · Ready',
      'Open Timing prediction Spec5 necessary work · Running',
    ]);
});

test('distinguishes a finished prediction from one still running', async ({ page }) => {
  await stubAnalyzer(page);
  await openCatalog(page);
  // The Analyzer's ready and running statuses remain distinct in the shared catalog.
  await expect(page.getByRole('option', { name: /Llama3 H200 throughput · Ready/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Spec5 necessary work · Running/ })).toBeVisible();
});

test.describe('with one catalog route failing', () => {
  // Chromium logs the 500 this test causes on purpose. The pattern names that
  // one request so every other console error still fails the test.
  test.use({ expectedConsoleErrors: [/Failed to load resource.*\/api\/analyzer\/v1\/sweeps/] });

  test('keeps the readable kinds when one catalog read fails', async ({ page }) => {
    await stubAnalyzer(page, 'sweeps');
    await openCatalog(page);

    await expect(page.getByRole('option', { name: /Llama3 H200 throughput/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /TP × request rate/ })).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Sweep' })).toBeVisible();
  });
});

test('restores a kind filter from the address and writes changes back to it', async ({ page }) => {
  await stubAnalyzer(page);
  await openCatalog(page, '#/results?w=w_main&kind=sweep');

  const catalog = page.getByRole('listbox', { name: 'Results, newest first' });
  await expect(catalog.getByRole('option', { name: /TP × request rate/ })).toBeVisible();
  await expect(catalog.getByRole('option', { name: /Llama3 H200 throughput/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Type/ }).click();
  await page.getByRole('button', { name: 'Timing prediction', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(catalog.getByRole('option')).toHaveCount(3);
  // The filter lives in the URL and nowhere else, so the address must have
  // followed the click.
  await expect(page).toHaveURL(/kind=sweep%2Cprediction|kind=sweep,prediction/);
});

test('reports an address it cannot represent instead of redirecting', async ({ page }) => {
  await stubAnalyzer(page);
  await openCatalog(page, '#/results?w=not-a-workspace');
  // Landing the user on a default page would hide that the link was wrong,
  // which is exactly what makes a stale evidence citation hard to diagnose.
  await expect(page.getByRole('alert')).toContainText('does not name anything');
});

test('opens a result from the catalog and puts it in the address', async ({ page }) => {
  await stubAnalyzer(page);
  await openCatalog(page);

  await page.getByRole('option', { name: /Llama3 H200 throughput/ }).click();
  await expect(page).toHaveURL(/#\/result\/prediction\/p_llama3_h200_throughput/);
});
