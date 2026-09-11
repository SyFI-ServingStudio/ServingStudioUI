import type { Page } from '@playwright/test';

import {
  RUN_LATENCY,
  RUN_MODEL,
  RUN_CONCURRENCY,
  RUN_SUMMARY,
  RUN_TOPOLOGY,
  serveRunBatch,
  serveRunKernelTime,
  serveRunKvOccupancy,
  serveRunRequestState,
  serveRunConservation,
  serveRunThroughput,
  serveRunUtilization,
  serveRunOverviewResources,
} from './fixtures/run';
import { expect, test } from './quality.fixture';

/**
 * The fourth slice: the way into a run.
 *
 * Every other panel on a run page consumes a drill-down segment — a pool, a
 * worker — and until now nothing in this build could produce one. The map is
 * where a reader gets them, so this spec is really about the address: clicking
 * a worker has to put that worker in the URL, and the URL has to be enough to
 * come back to.
 *
 * It also checks the asymmetry the panel is built around. The topology is the
 * panel; the model config only decorates it. A run whose model could not be
 * read is still a run a reader can navigate.
 */

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

async function stubAnalyzer(
  page: Page,
  options: { topologyStatus?: number; modelStatus?: number } = {},
): Promise<void> {
  // Registered first because Playwright matches the most recently added route
  // first: this is the fallback and everything below overrides it. A read that
  // lands here is a panel asking for something this address does not have.
  await page.route(`**/api/analyzer/v1/**`, (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/summary/report*`, (route) =>
    route.fulfill({ json: RUN_SUMMARY }),
  );
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/slo-general/payload*`, (route) =>
    route.fulfill({ json: RUN_LATENCY }),
  );
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/concurrency/payload*`, (route) =>
    route.fulfill({ json: RUN_CONCURRENCY }),
  );
  // Opening a worker brings the other run panels onto the page with it. They
  // are other specs' subjects; here they only have to stop complaining, so
  // their reads are answered from the same fixture run.
  await serveRunKernelTime(page);
  await serveRunRequestState(page);
  await serveRunUtilization(page);
  await serveRunKvOccupancy(page);
  await serveRunBatch(page);
  await serveRunThroughput(page);
  await serveRunConservation(page);
  await serveRunOverviewResources(page);
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/topology/payload*`, (route) => {
    if (options.topologyStatus !== undefined) {
      return route.fulfill({ status: options.topologyStatus, body: 'no' });
    }
    return route.fulfill({ json: RUN_TOPOLOGY });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/model/payload*`, (route) => {
    if (options.modelStatus !== undefined) {
      return route.fulfill({ status: options.modelStatus, body: 'no' });
    }
    return route.fulfill({ json: RUN_MODEL });
  });
}

async function open(page: Page, hash = ADDRESS): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('draws the run’s pools and workers from the address alone', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  await expect(page.getByTestId('system-map')).toBeVisible();
  await expect(page.getByTestId('system-map-cluster')).toContainText('2 pools');
  await expect(page.getByTestId('system-map-cluster')).toContainText('4 GPU');

  const prefill = page.getByTestId('system-map-pool-prefill');
  await expect(prefill).toContainText('2 workers');
  await expect(prefill).toContainText('2×1=2 GPU');
  await expect(prefill).toContainText('least-queued');
  // The run overrode no layer count, so the checkpoint's is what ran.
  await expect(prefill).toContainText('L=32');
  await expect(prefill).toContainText('TP=1');
  // The legacy map shows dtype only when the run records one explicitly.
  await expect(prefill).not.toContainText('bfloat16');

  // Nothing is selected at the top of a run, and the cluster row says so.
  await expect(page.getByTestId('system-map-cluster')).toHaveAttribute('aria-pressed', 'true');
});

test('clicking a worker puts that worker in the address', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  await page.getByTestId('system-map-worker-decode-1').click();

  // The whole point: the drill-down is in the URL, so this page can be shared
  // and returned to. Nothing about it lives in a store.
  await expect(page).toHaveURL(/pool:decode\.worker:1/);
  await expect(page.getByTestId('system-map-worker-decode-1')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The worker is the exact pressed control; the parent pool remains the visible container.
  await expect(page.getByTestId('system-map-pool-button-decode')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // And worker 1 of the *other* pool is a different worker.
  await expect(page.getByTestId('system-map-worker-prefill-1')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByTestId('system-map-cluster')).toHaveAttribute('aria-pressed', 'false');
});

test('the cluster row is the way back out', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page, `${ADDRESS}&at=pool:decode.worker:1`);

  await expect(page.getByTestId('system-map-worker-decode-1')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('system-map-cluster').click();
  await expect(page).not.toHaveURL(/pool:decode/);
  await expect(page.getByTestId('system-map-cluster')).toHaveAttribute('aria-pressed', 'true');
});

test.describe('with the model config missing', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource.*subjects\/model/] });

  test('still draws the map, with fewer chips on it', async ({ page }) => {
    // The model config decorates; the topology is the panel. A reader whose
    // model file could not be read can still find their way to a worker.
    await stubAnalyzer(page, { modelStatus: 500 });
    await open(page);

    const prefill = page.getByTestId('system-map-pool-prefill');
    await expect(prefill).toContainText('2 workers');
    await expect(prefill).not.toContainText('L=32');
    await page.getByTestId('system-map-worker-prefill-0').click();
    await expect(page).toHaveURL(/pool:prefill\.worker:0/);
  });
});

test.describe('with the topology missing', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource.*subjects\/topology/] });

  test('reports the read rather than drawing an empty map', async ({ page }) => {
    await stubAnalyzer(page, { topologyStatus: 500 });
    await open(page);

    await expect(page.getByTestId('system-map-problem')).toContainText('could not be read');
    await expect(page.getByTestId('system-map')).toBeHidden();
    // And the rest of the page is unaffected: a broken topology is not a broken run.
    await expect(page.getByTestId('run-headline')).toBeVisible();
  });
});
