import type { Page, Route } from '@playwright/test';

import {
  RUN_CONCURRENCY,
  RUN_KERNEL_TIME,
  RUN_LATENCY,
  RUN_MODEL,
  RUN_REQUEST_STATE_SERIES,
  RUN_SUMMARY,
  RUN_TOPOLOGY,
  RUN_WORKLOAD,
  RUN_UTILIZATION_SERIES,
  RUN_CONSERVATION,
  RUN_THROUGHPUT_SERIES,
  RUN_DESCRIPTOR,
  RUN_OPTIMALITY_UNAVAILABLE,
} from './fixtures/run';
import { expect, test } from './quality.fixture';

/**
 * The third vertical slice: what a run achieved, from a URL.
 *
 * The point of this one is that a result page is now more than one panel. The
 * address names a run and nothing else; the layout decides that the headline
 * belongs at the top, and the headline decides which two documents it needs.
 * The reader clicks nothing.
 *
 * It also checks the asymmetry the panel is built around: the summary is the
 * panel, and the latencies are an addition. One missing is a page; both would
 * be a problem, and only one of those is reported as one.
 */

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

interface Stub {
  readonly urls: string[];
}

async function stubAnalyzer(
  page: Page,
  options: { latencyStatus?: number; summaryStatus?: number } = {},
): Promise<Stub> {
  const urls: string[] = [];
  const record = (route: Route) => urls.push(new URL(route.request().url()).pathname);

  // Registered first because Playwright matches the most recently added route
  // first: this is the fallback, and the specific routes below override it. A
  // read that lands here is a panel asking for something no panel on this
  // address declared, which is a bug in the layout rather than in the panel.
  await page.route(`**/api/analyzer/v1/**`, (route) => {
    record(route);
    return route.fulfill({ status: 404, body: 'not served' });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/summary/report*`, (route) => {
    record(route);
    if (options.summaryStatus !== undefined) {
      return route.fulfill({ status: options.summaryStatus, body: 'no' });
    }
    return route.fulfill({ json: RUN_SUMMARY });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/slo-general/payload*`, (route) => {
    record(route);
    if (options.latencyStatus !== undefined) {
      return route.fulfill({ status: options.latencyStatus, body: 'no' });
    }
    return route.fulfill({ json: RUN_LATENCY });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/concurrency/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_CONCURRENCY });
  });
  // The map shares the page with the headline, so its two reads happen whether
  // or not this spec is about them. Answered, and counted below, because the
  // assertion is about what the *page* asked for.
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/topology/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_TOPOLOGY });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/model/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_MODEL });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/workload/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_WORKLOAD });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/descriptor*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_DESCRIPTOR });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/optimality/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_OPTIMALITY_UNAVAILABLE });
  });
  await page.route(`**/api/analyzer/v1/runs`, (route) => {
    record(route);
    return route.fulfill({
      json: {
        protocol_version: 1,
        generated_at: '2026-09-10T00:00:00Z',
        runs: [
          {
            workspace_id: 'w_main',
            run_id: RUN,
            display_name: 'Llama 3 8B · H200 throughput',
            lifecycle: { simulation: 'complete', analysis: 'complete' },
            updated_at: '2026-09-10T00:00:00Z',
          },
        ],
      },
    });
  });
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/subjects/kernel-time-share/payload*`,
    (route) => {
      record(route);
      return route.fulfill({ json: RUN_KERNEL_TIME });
    },
  );
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/request-state/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_REQUEST_STATE_SERIES });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/utilization/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_UTILIZATION_SERIES });
  });
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/throughput/payload*`, (route) => {
    record(route);
    return route.fulfill({ json: RUN_THROUGHPUT_SERIES });
  });
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/subjects/workload-conservation/report*`,
    (route) => {
      record(route);
      return route.fulfill({ json: RUN_CONSERVATION });
    },
  );
  return { urls };
}

async function open(page: Page, hash = ADDRESS): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('renders a run headline from the address alone', async ({ page }) => {
  const stub = await stubAnalyzer(page);
  await open(page);

  const headline = page.getByTestId('run-headline');
  await expect(headline).toBeVisible();
  await expect(headline).toContainText('1,279');
  await expect(headline).toContainText('tok/s');
  // Latencies in reading order, and the end-to-end one in seconds because
  // 41,000 ms is a number a reader has to count digits in.
  await expect(headline).toContainText('TTFT p50');
  // The p50 of the E2E curve, in seconds: the fixture reads its markers off the
  // 512-point CDF rather than stating them beside it.
  await expect(headline).toContainText('41.5');
  await expect(headline).toContainText('Model overview');
  await expect(headline).toContainText('Simulation overview');
  await expect(headline).toContainText('Trace overview');
  await expect(headline).toContainText('model/config/llama3_8b.json');
  await expect(headline).toContainText('analyzer folder · topology · parallelism · placement');
  await expect(headline).toContainText('Llama 3 8B · H200 throughput');
  await expect(headline).toContainText('sharegpt.csv');
  const lengthChart = headline.getByRole('img', {
    name: 'Configured trace input and output token length distributions',
  });
  const arrivalChart = headline.getByRole('img', {
    name: 'Configured trace effective request rate over time',
  });
  await expect(lengthChart.locator('svg')).toBeVisible();
  await expect(arrivalChart.locator('svg')).toBeVisible();

  // The latency payload is shared with the first row of the old cluster stage.
  // Each distribution remains its own card and opens in the shared chart focus.
  const slo = page.getByTestId('slo-chart-row');
  await expect(slo).toBeVisible();
  await expect(slo).toContainText('a1TTFT latency');
  await expect(slo).toContainText('a2TPOT latency');
  await expect(slo).toContainText('a3E2E latency');
  await expect(slo.getByRole('img', { name: /TTFT latency/ }).locator('svg')).toBeVisible();
  await expect(slo.getByRole('img', { name: /TPOT latency/ }).locator('svg')).toBeVisible();
  await expect(slo.getByRole('img', { name: /E2E latency/ }).locator('svg')).toBeVisible();

  // Exactly what the panels on this address declared they need, and nothing
  // else: the headline's summary and latencies, the map's topology and model,
  // and one document each for the cluster-stage analyses. The *set* rather than the count,
  // because React's development double-mount repeats a fetch, which says
  // nothing about what was asked for.
  expect([...new Set(stub.urls)].sort()).toEqual([
    `/api/analyzer/v1/runs`,
    `/api/analyzer/v1/runs/${RUN}/descriptor`,
    `/api/analyzer/v1/runs/${RUN}/subjects/concurrency/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/kernel-time-share/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/model/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/optimality/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/request-state/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/slo-general/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/summary/report`,
    `/api/analyzer/v1/runs/${RUN}/subjects/throughput/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/topology/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/utilization/payload`,
    `/api/analyzer/v1/runs/${RUN}/subjects/workload-conservation/report`,
    `/api/analyzer/v1/runs/${RUN}/subjects/workload/payload`,
  ]);

  await page.getByRole('button', { name: 'Expand TPOT latency' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('TPOT latency');
  await expect(dialog).not.toContainText('TTFT latency');
});

test.describe('with the latency analysis missing', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource.*slo-general/] });

  test('still shows the throughput, and says which figure is absent', async ({ page }) => {
    // A run whose analysis has not produced latencies is still a run with a
    // throughput. Refusing to render would hide the half that exists.
    await stubAnalyzer(page, { latencyStatus: 410 });
    await open(page);

    await expect(page.getByTestId('run-headline')).toContainText('1,279');
    await expect(page.getByTestId('run-latency-problem')).toContainText('never generated');
    await expect(
      page.getByTestId('slo-chart-row').getByText(/^Analyzer subject slo is not generated\./),
    ).toHaveCount(3);
    await expect(page.getByTestId('slo-chart-row').getByRole('img')).toHaveCount(0);
  });
});

test.describe('with the run summary missing', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource.*summary/] });

  test('reports the read rather than drawing an empty statline', async ({ page }) => {
    await stubAnalyzer(page, { summaryStatus: 500 });
    await open(page);

    await expect(page.getByTestId('run-headline-problem')).toContainText('could not be read');
    await expect(page.getByTestId('run-headline')).toBeHidden();
  });
});
