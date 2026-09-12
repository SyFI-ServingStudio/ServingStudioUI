import type { Page, Route } from '@playwright/test';

import { RUN_KERNEL_TIME, serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main&at=pool:ffn.worker:2&panel=worker.cost-tree`;

function operation(ordinal: number, startMs: number, endMs: number) {
  return {
    ordinal,
    iter_id: '17',
    batch_id: '2',
    operation_id: String(ordinal),
    section: ordinal === 0 ? 'pre_ffn' : 'ffn',
    layer: 3,
    start_ms: startMs,
    end_ms: endMs,
  };
}

const OPERATIONS = [operation(0, 10, 10.5), operation(1, 12, 13)];

const DESCRIPTOR = {
  protocol_version: 1,
  workspace_id: 'w_main',
  run_id: RUN,
  kind: 'simulation',
  deployment: 'afd',
  lifecycle: { simulation: 'complete', analysis: 'complete' },
  summary: { views: ['report'] },
  subjects: {
    'kernel-input-distribution': {
      status: 'ready',
      schema_version: 1,
      views: ['payload'],
    },
    'scoped-optimality': {
      status: 'ready',
      schema_version: 1,
      views: ['report'],
    },
  },
  details: {
    'worker-operation-index': {
      status: 'ready',
      schema_version: 1,
      views: ['payload'],
    },
    'worker-cost-tree': {
      status: 'ready',
      schema_version: 1,
      views: ['payload'],
    },
  },
  traces: {},
  analysis: {
    revision: 'analysis-v2',
    generated_at: '2026-09-10T00:00:00Z',
    generator_version: 'test',
  },
};
function rangeBody() {
  return {
    schema_version: 1,
    worker: { pool_tag: 'ffn', worker_id: 2 },
    worker_kind: 'afd_ffn',
    batch_role: 'slot',
    total_operations: OPERATIONS.length,
    span: { start_ms: 10, end_ms: 13 },
    range: { offset: 0, limit: 192, returned: OPERATIONS.length },
    operations: OPERATIONS,
  };
}

function seekBody(atMs: number) {
  return {
    schema_version: 1,
    worker: { pool_tag: 'ffn', worker_id: 2 },
    worker_kind: 'afd_ffn',
    batch_role: 'slot',
    at_ms: atMs,
    total_operations: OPERATIONS.length,
    span: { start_ms: 10, end_ms: 13 },
    hits: [OPERATIONS[1]],
    anchor: { ordinal: 1, kind: 'hit' },
    suggested_viewport: { offset: 0, limit: 64 },
    buffer: {
      offset: 0,
      limit: 192,
      returned: OPERATIONS.length,
      operations: OPERATIONS,
    },
  };
}

function costTreeBody(operationId: string) {
  return {
    schema_version: 1,
    identity: {
      pool_tag: 'ffn',
      worker_id: 2,
      iter_id: 17,
      batch_id: 2,
      operation_id: operationId,
      section: 'ffn',
      layer: 3,
    },
    interval: { start_ms: 12, end_ms: 13 },
    inputs: [],
    tree: {
      kind: 'leaf',
      slot: {
        name: 'ffn.gemm',
        kind: 'single_gemm',
        kernel_config: { m: 8 },
        backend: 'torch',
      },
      base: 1,
      stats: { input: { m: 8 }, flops: 10, bytes: 20, tflops: 0.1, gbps: 0.2 },
    },
  };
}

function kernelThroughputBody(operationId: string) {
  return {
    schema_version: 1,
    identity: {
      pool_tag: 'ffn',
      worker_id: 2,
      iter_id: 17,
      batch_id: 2,
      operation_id: operationId,
      section: 'ffn',
      layer: 3,
    },
    leaf_id: 0,
    slot: {
      name: 'ffn.gemm',
      kind: 'single_gemm',
      kernel_config: { m: 8 },
      backend: 'torch',
    },
    exact_input: { m: 8 },
    describe_config: { dtype: 'bf16' },
    input_fields: ['m'],
    grid_axes: [[4, 8]],
    points: [
      { input: { m: 4 }, time_ms: 0.8, flops: 8, bytes: 16, energy_j: 0, coverage: 1 },
      { input: { m: 8 }, time_ms: 1, flops: 10, bytes: 20, energy_j: 0, coverage: 2 },
    ],
    semantics: 'cache_eval_at_declared_grid',
  };
}

const KERNEL_INPUT_DISTRIBUTION = {
  schema_version: 1,
  available: true,
  meta: {
    log_dir: 'logs/test-run',
    sample_stride: 1,
    sampled_rows: 2,
    num_positions_plotted: 1,
    num_positions_multi_backend: 0,
    num_positions_manifest: 1,
    num_positions_omitted: 0,
    num_positions_without_candidates: 0,
    skipped_not_executed_slots: 0,
    skipped_empty_input_slots: 0,
    max_points_per_position: 6000,
  },
  positions: [
    {
      name: 'ffn.gemm',
      kind: 'single_gemm',
      candidate_backends: ['torch'],
      selection: [{ backend_index: 0, backend_name: 'torch', count: 2, ratio: 1 }],
      projection: 'feature_1d',
      axis_labels: ['m', ''],
      explained_variance: null,
      points: [
        { x: 4, y: 0, backend_index: 0, backend_name: 'torch', count: 1 },
        { x: 8, y: 0, backend_index: 0, backend_name: 'torch', count: 1 },
      ],
    },
  ],
  definitions: {
    scope: 'sampled cost-log slots grouped by tree position',
    position: 'the exact manifest position name',
    backend: 'the selected backend index',
    point: 'one deduplicated observation',
    features: 'numeric input features',
    projection: 'the display projection',
    sampling: 'bounded per-position sampling',
  },
};

async function stubWorkerOperations(page: Page): Promise<string[]> {
  const urls: string[] = [];
  const record = (route: Route) => urls.push(new URL(route.request().url()).href);
  await page.route(`**/api/analyzer/v1/runs/${RUN}/descriptor*`, (route) => {
    record(route);
    return route.fulfill({ json: DESCRIPTOR, headers: { etag: '"descriptor-body"' } });
  });
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/workers/ffn/2/subjects/operations/payload*`,
    (route) => {
      record(route);
      return route.fulfill({ json: rangeBody() });
    },
  );
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/workers/ffn/2/subjects/operations/seek*`,
    (route) => {
      record(route);
      const atMs = Number(new URL(route.request().url()).searchParams.get('at_ms'));
      return route.fulfill({ json: seekBody(atMs) });
    },
  );
  await page.route(`**/api/analyzer/v1/runs/${RUN}/subjects/kernel-time-share/payload*`, (route) =>
    route.fulfill({ json: RUN_KERNEL_TIME }),
  );
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/workers/ffn/2/subjects/kernel-time-share/payload*`,
    (route) =>
      route.fulfill({
        json: {
          schema_version: 2,
          scope: { kind: 'worker', pool_tag: 'ffn', worker_id: 2 },
          kernel_time_ms: 100,
          raw_rows: 10,
          sampled_rows: 10,
          sample_stride: 1,
          segments: RUN_KERNEL_TIME.overall.segments,
        },
      }),
  );
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/workers/ffn/2/operations/17/2/*/subjects/cost-tree/payload*`,
    (route) => {
      record(route);
      const parts = new URL(route.request().url()).pathname.split('/');
      const operationId = decodeURIComponent(parts[parts.indexOf('operations') + 3]);
      return route.fulfill({ json: costTreeBody(operationId) });
    },
  );
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/workers/ffn/2/operations/17/2/*/leaves/0/subjects/kernel-throughput-analysis/payload*`,
    (route) => {
      record(route);
      const parts = new URL(route.request().url()).pathname.split('/');
      const operationId = decodeURIComponent(parts[parts.indexOf('operations') + 3]);
      return route.fulfill({ json: kernelThroughputBody(operationId) });
    },
  );
  await page.route(
    `**/api/analyzer/v1/runs/${RUN}/subjects/kernel-input-distribution/payload*`,
    (route) => {
      record(route);
      return route.fulfill({ json: KERNEL_INPUT_DISTRIBUTION });
    },
  );
  return urls;
}

async function open(page: Page, address = ADDRESS): Promise<string[]> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
  const urls = await stubWorkerOperations(page);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${address}`);
  return urls;
}

test('reproduces the exact operation timeline in the worker workbench', async ({ page }) => {
  const urls = await open(page);

  await expect(page.getByRole('heading', { name: 'Worker · ffn/2' })).toBeVisible();
  const timeline = page.getByText('Worker ffn/2 · operation selection').locator('..');
  await expect(timeline).toContainText('2 exact operations');
  await expect(page.getByLabel('slot color legend')).toContainText('color →2');
  await expect(page.getByRole('application')).toHaveAttribute(
    'aria-label',
    'Exact worker operations; drag horizontally to navigate',
  );
  await expect(page.getByText('P95 1.00 ms')).toBeVisible();

  expect(urls.some((url) => url.includes('limit=192') && url.includes('rev=analysis-v2'))).toBe(
    true,
  );
});

test('commits the exact operation and keeps the existing Worker toggle', async ({ page }) => {
  const urls = await open(page);
  const track = page.getByRole('application');
  const width = await track.evaluate((element) => element.getBoundingClientRect().width);
  await track.click({ position: { x: width * 0.75, y: 48 } });

  await expect
    .poll(() => new URL(page.url()).hash)
    .toContain('at=pool:ffn.worker:2.operation:17~2~1');
  await expect.poll(() => new URL(page.url()).hash).toContain('&t=12');
  await expect(page.getByText(/iter 17 · slot 2 · ffn · layer 3/)).toBeVisible();
  expect(urls.some((url) => url.includes('/subjects/operations/seek'))).toBe(false);
  await expect(page.getByRole('region', { name: 'Worker CostTree canvas' })).toBeVisible();
  expect(
    urls.some(
      (url) =>
        url.includes('/operations/17/2/1/subjects/cost-tree/payload') &&
        url.includes('rev=analysis-v2'),
    ),
  ).toBe(true);
  await expect(page.getByRole('heading', { name: 'Kernel time breakdown' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Kernel position time share' })).toBeVisible();

  await page.getByRole('button', { name: 'Inspect kernel ffn.gemm' }).click();
  await expect.poll(() => new URL(page.url()).hash).toContain('.leaf:0');
  await expect(page.getByTestId('kernel-inspector')).toContainText('exact throughput');
  await expect(page.getByTestId('kernel-inspector')).toContainText('0.1 TFLOP/s');
  await expect(page.getByTestId('kernel-throughput-analysis-card')).toContainText(
    'Rust cache · 2 grid points',
  );
  await expect(page.getByTestId('kernel-input-distribution')).toContainText(
    'sampled every 1 iteration(s) · feature 1d',
  );
  await expect(page.getByRole('button', { name: 'Compute' })).toBeEnabled();
  await page.getByTestId('scoped-optimality-card').click();
  await expect.poll(() => new URL(page.url()).hash).toContain('o.evidence-panel=scoped-optimality');
  expect(
    urls.some(
      (url) =>
        url.includes('/operations/17/2/1/leaves/0/subjects/kernel-throughput-analysis/payload') &&
        url.includes('rev=analysis-v2'),
    ),
  ).toBe(true);
  expect(
    urls.some(
      (url) =>
        url.includes('/subjects/kernel-input-distribution/payload') &&
        url.includes('rev=analysis-v2'),
    ),
  ).toBe(true);

  await page.getByRole('button', { name: 'Worker', exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).not.toContain('panel=worker.cost-tree');
  await expect.poll(() => new URL(page.url()).hash).not.toContain('operation:');
});

test('resolves a shared wall-clock cursor to an operation without changing its time', async ({
  page,
}) => {
  await open(page, `${ADDRESS}&t=12.25`);

  await expect
    .poll(() => new URL(page.url()).hash)
    .toContain('at=pool:ffn.worker:2.operation:17~2~1');
  await expect.poll(() => new URL(page.url()).hash).toContain('&t=12.25');
  await expect(page.getByText(/iter 17 · slot 2 · ffn · layer 3/)).toBeVisible();
});

test('enters iteration analysis from the ordinary worker page', async ({ page }) => {
  const workerAddress = ADDRESS.replace('&panel=worker.cost-tree', '');
  await open(page, workerAddress);

  await expect(page.getByRole('heading', { name: 'Worker · ffn/2' })).toBeVisible();
  const level = page.getByRole('group', { name: 'Worker analysis level' });
  await expect(level.getByRole('button', { name: 'Worker' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await level.getByRole('button', { name: 'Iteration' }).click();

  await expect.poll(() => new URL(page.url()).hash).toContain('panel=worker.cost-tree');
  await expect(page.getByText('Worker ffn/2 · operation selection')).toBeVisible();
});
