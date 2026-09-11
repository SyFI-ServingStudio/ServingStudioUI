import type { Page, Route } from '@playwright/test';

import { expect, test } from './quality.fixture';

/**
 * The second vertical slice: a worker's kernel-time composition, from a URL.
 *
 * What this checks is the arrangement, not the numbers. A hash that names a
 * result, a pool, a worker and a panel is enough to render — nothing is fetched
 * by a parent and handed down, and no click path has to run first. It also
 * checks the part that A7 introduced: the panel makes two requests, one for the
 * result and one for the worker, and never asks for any other worker.
 */

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main&at=pool:attn.worker:0&panel=worker.kernel-time-share`;

/**
 * The two workers' cost-log row counts, and the sampling they imply.
 *
 * `kernel_time_share.rs` gives every worker `MAX_REPLAY_ROWS / n_workers` rows
 * and picks the smallest stride that fits, so a report's stride is not a
 * setting it carries — it follows from the row counts and the roster size. At
 * 400 and 200 rows over two workers, both are replayed whole and the report
 * would say `exact`; the stride of 10 this fixture used to declare could not
 * have been produced for it. These counts are what a strided report looks like.
 */
const REPLAY_BUDGET_PER_WORKER = 250_000 / 2;

function sampled(rawRows: number) {
  const stride = Math.max(Math.ceil(rawRows / REPLAY_BUDGET_PER_WORKER), 1);
  return { raw_rows: rawRows, sampled_rows: Math.ceil(rawRows / stride), sample_stride: stride };
}

const ROWS = { worker0: sampled(1_200_000), worker1: sampled(500_000) };

const CLUSTER = {
  schema_version: 2,
  available: true,
  meta: {
    exact: false,
    sampling_method: 'worker-local regular iter_id stride',
    max_replay_rows_target: 250_000,
    raw_rows: ROWS.worker0.raw_rows + ROWS.worker1.raw_rows,
    sampled_rows: ROWS.worker0.sampled_rows + ROWS.worker1.sampled_rows,
    num_positions: 2,
    num_pools: 1,
    num_workers: 2,
  },
  overall: {
    kernel_time_ms: 40,
    segments: [
      {
        position: 'attn.decode',
        kind: 'flashinfer_attn_decode',
        kernel_time_ms: 30,
        share_pct: 75,
      },
      { position: 'ffn.gemm', kind: 'single_gemm', kernel_time_ms: 10, share_pct: 25 },
    ],
  },
  pools: [
    {
      pool_tag: 'attn',
      num_workers: 2,
      kernel_time_ms: 40,
      segments: [
        {
          position: 'attn.decode',
          kind: 'flashinfer_attn_decode',
          kernel_time_ms: 30,
          share_pct: 75,
        },
        { position: 'ffn.gemm', kind: 'single_gemm', kernel_time_ms: 10, share_pct: 25 },
      ],
    },
  ],
  workers: [
    { pool_tag: 'attn', worker_id: 0, kernel_time_ms: 10, ...ROWS.worker0 },
    { pool_tag: 'attn', worker_id: 1, kernel_time_ms: 30, ...ROWS.worker1 },
  ],
  positions: [
    { name: 'attn.decode', kind: 'flashinfer_attn_decode', overall_share_pct: 75 },
    { name: 'ffn.gemm', kind: 'single_gemm', overall_share_pct: 25 },
  ],
  definitions: { tree_attribution: 'critical path with Sum/Scale/Max/overlap' },
};

const WORKER_0 = {
  schema_version: 2,
  scope: { kind: 'worker', pool_tag: 'attn', worker_id: 0 },
  kernel_time_ms: 10,
  ...ROWS.worker0,
  segments: [
    { position: 'ffn.gemm', kind: 'single_gemm', kernel_time_ms: 2, share_pct: 20 },
    { position: 'attn.decode', kind: 'flashinfer_attn_decode', kernel_time_ms: 8, share_pct: 80 },
  ],
};

interface Stub {
  readonly urls: string[];
}

/**
 * Stub both reads and record which addresses were asked for.
 *
 * The recording is the assertion for the split: if the panel ever fetched the
 * whole cluster's worker compositions, a second worker address would show up
 * here.
 */
async function stubAnalyzer(page: Page, options: { workerStatus?: number } = {}): Promise<Stub> {
  const urls: string[] = [];
  const record = (route: Route) => urls.push(new URL(route.request().url()).pathname);

  await page.route('**/api/analyzer/v1/runs', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', runs: [] },
    }),
  );

  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/subjects/kernel-time-share/payload*`,
    (route) => {
      record(route);
      return route.fulfill({ json: CLUSTER });
    },
  );
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/workers/*/*/subjects/kernel-time-share/payload*`,
    (route) => {
      record(route);
      if (options.workerStatus !== undefined) {
        return route.fulfill({ status: options.workerStatus, body: 'no' });
      }
      // The real service answers 404 for a worker it cannot address, and the
      // panel must not need that answer to know the run has no such worker.
      const path = new URL(route.request().url()).pathname;
      return path.includes('/workers/attn/0/')
        ? route.fulfill({ json: WORKER_0 })
        : route.fulfill({ status: 404, body: 'no such worker' });
    },
  );
  return { urls };
}

async function open(page: Page, hash = ADDRESS): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('renders a worker composition from the address alone', async ({ page }) => {
  const stub = await stubAnalyzer(page);
  await open(page);

  const panel = page.getByTestId('kernel-time-worker-attn-0');
  await expect(panel).toContainText(/f\s*Worker kernel time breakdown · attn\/0/);
  await expect(panel).toContainText('all operations · sampled position mix · exact total');
  await expect(panel).toContainText('10 ms total · 120,000 / 1,200,000 rows replayed');
  await expect(panel.getByText('by kernel family', { exact: true })).toBeVisible();
  await expect(panel.getByText('by kernel position', { exact: true })).toBeVisible();
  await expect(panel.getByText('decode', { exact: true })).toBeVisible();
  await expect(panel.getByText('80.0%', { exact: true })).toHaveCount(2);
  await panel.getByRole('button', { name: 'Expand Worker kernel time breakdown · attn/0' }).click();
  await expect(page.getByRole('dialog')).toContainText('Worker kernel time breakdown · attn/0');

  // The set, not the sequence: React's development double-mount repeats each
  // read, and counting repeats would test the dev server rather than the panel.
  // What matters is that no *other* worker was ever asked for.
  expect([...new Set(stub.urls)].sort()).toEqual([
    `/api/analyzer/v1/runs/${RUN}/subjects/kernel-time-share/payload`,
    `/api/analyzer/v1/runs/${RUN}/workers/attn/0/subjects/kernel-time-share/payload`,
  ]);
});

test('says the mixture is estimated when the worker was sampled', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  // Stated rather than implied: a reader should not have to notice the absence
  // of a disclaimer to know the numbers are exact.
  await expect(page.getByTestId('kernel-time-worker-attn-0')).toContainText(
    'all operations · sampled position mix · exact total',
  );
});

test.describe('addressing a worker the result does not have', () => {
  test.use({
    expectedConsoleErrors: [
      /Failed to load resource.*workers\/attn\/9\/subjects\/kernel-time-share/,
    ],
  });

  test('says the run has no such worker rather than blaming the read', async ({ page }) => {
    await stubAnalyzer(page);
    await open(page, ADDRESS.replace('worker:0', 'worker:9'));

    // The worker read 404s here too, but the cluster read already knows the
    // answer, and "no such worker" sends the reader somewhere useful while
    // "this Analyzer does not serve that" would not.
    await expect(page.getByTestId('kernel-time-worker-attn-9')).toContainText(
      'has no worker attn/9',
    );
  });
});

test.describe('with the worker read unavailable', () => {
  test.use({
    expectedConsoleErrors: [
      /Failed to load resource.*workers\/attn\/0\/subjects\/kernel-time-share/,
    ],
  });

  test('distinguishes an Analyzer that does not serve the scope from a broken one', async ({
    page,
  }) => {
    await stubAnalyzer(page, { workerStatus: 404 });
    await open(page);

    // 404 on an address this build constructs means the deployment predates the
    // per-worker scope, which calls for an upgrade rather than a retry.
    await expect(page.getByTestId('kernel-time-worker-attn-0')).toContainText(
      'not served by this Analyzer',
    );
  });
});
