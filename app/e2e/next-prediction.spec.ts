import type { Page } from '@playwright/test';

import { expect, test } from './quality.fixture';

const PREDICTION_ID = 'p_one';
const CATALOG = {
  protocol_version: 1,
  generated_at: '2026-09-10T00:00:00Z',
  predictions: [
    {
      workspace_id: 'w_main',
      prediction_id: PREDICTION_ID,
      display_name: 'Llama timing prediction',
      status: 'ready',
      updated_at: '2026-09-10T00:00:00Z',
    },
  ],
};
const DESCRIPTOR = {
  schema_version: 1,
  prediction_id: PREDICTION_ID,
  kind: 'timing_predict',
  display_name: 'Llama timing prediction',
  selector: 'iter',
  arch: { type: 'llama' },
  gpu: { name: 'NVIDIA H200', count: 8 },
  case_count: 1,
  lifecycle: { prediction: 'complete', analysis: 'not_started' },
  resources: {
    cases: { views: ['payload'] },
    'kernel-input-distribution': null,
    'scoped-optimality': { views: ['report'] },
  },
};
const CASES = {
  schema_version: 1,
  prediction_id: PREDICTION_ID,
  range: { offset: 0, limit: 64, returned: 1, total: 1 },
  cases: [
    {
      case_id: 0,
      input: { groups: [{ decode_count: 4, average_decode_length: 128 }] },
      total_time_ms: 2.5,
      operations: [{ operation_id: 0, section: 'attn', layer: 0, time_ms: 2.5 }],
    },
  ],
};
const COST_TREE = {
  schema_version: 1,
  identity: {
    prediction_id: PREDICTION_ID,
    case_id: 0,
    operation_id: 0,
    section: 'attn',
    layer: 0,
  },
  interval: { start_ms: 0, end_ms: 2.5 },
  inputs: [
    {
      section: 'attn',
      layer: 0,
      groups: [
        {
          batch_tokens: 4,
          prefill_tokens: 0,
          decode_request_count: 4,
          decode_kv_total: 512,
          prefill_chunk_pairs: [],
        },
      ],
    },
  ],
  tree: {
    kind: 'sum',
    label: 'attention',
    children: [
      {
        kind: 'sum',
        label: 'attention projection',
        children: [
          {
            kind: 'leaf',
            slot: {
              name: 'model.gemm',
              kind: 'single_gemm',
              kernel_config: { dtype: 'bf16' },
              backend: 'torch',
            },
            base: 2.5,
            stats: {
              input: { m: 4, n: 128 },
              flops: 1024,
              bytes: 512,
              tflops: 0.0004,
              gbps: 0.0002,
            },
          },
        ],
      },
    ],
  },
};
const SCOPED = {
  schema_version: 1,
  report_type: 'optimality_scoped_v1',
  log_dir: '/redacted',
  selection: {
    selector: { path: 'attn/0', label: null },
    section: 'attn',
    canonical_path: 'attn/0',
    node_kind: 'sum',
    node_label: 'attention projection',
    matched_manifest_workers: 8,
    matched_cost_log_rows: 32,
    descendant_leaves: ['model.gemm'],
  },
  rungs: {
    r0_measured: { value_gpu_seconds: 0.02, unit: 'gpu_seconds', definition: 'measured' },
    r5_hardware_limit: { value_gpu_seconds: 0.01, unit: 'gpu_seconds', definition: 'floor' },
  },
  omitted_rungs: [],
  provenance: {},
};
const RUNGS = {
  real: 2.5,
  busy: 2.5,
  balanced: 2,
  per_config_best: 1.8,
  ignore_network: 1.7,
  hardware_limit: 1.5,
};
const LADDER = {
  schema_version: 1,
  unit: 'gpu_seconds',
  prediction_id: PREDICTION_ID,
  case_id: 0,
  rungs: RUNGS,
  special_chunks: { idle: 0, imbalance: 0.5 },
  kernels: [
    {
      name: 'model.gemm',
      kind: 'single_gemm',
      is_comm: false,
      rungs: { balanced: 2, per_config_best: 1.8, ignore_network: 1.7, hardware_limit: 1.5 },
    },
  ],
  meta: {
    gpu_name: 'NVIDIA H200',
    gpu_spec_matched: 'H200-SXM-141GB',
    peaks_source: 'generated',
    gpu_count: 8,
    folded_rows: 1,
    necessary_work_mode: 'replicated_large_batch',
    necessary_work_replication_factor: 1,
  },
};
const WATERFALL = {
  schema_version: 1,
  unit: 'gpu_seconds',
  prediction_id: PREDICTION_ID,
  case_id: 0,
  level: {
    level: 'iteration',
    key: 'case/0',
    label: 'case 0',
    total: 2.5,
    buckets: {
      idle: 0,
      imbalance: 0.5,
      batching: 0.2,
      communication: 0.1,
      hardware_gap: 0.2,
      hardware_optimal: 1.5,
    },
    optimality_ratio: 0.6,
  },
  meta: {
    gpu_name: 'NVIDIA H200',
    gpu_spec_matched: 'H200-SXM-141GB',
    peaks_source: 'generated',
    necessary_work_mode: 'replicated_large_batch',
    necessary_work_replication_factor: 1,
  },
};

async function openPrediction(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) => route.fulfill({ status: 404, body: 'no' }));
  await page.route('**/api/analyzer/v1/predictions', (route) => route.fulfill({ json: CATALOG }));
  await page.route('**/api/analyzer/v1/runs', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', runs: [] },
    }),
  );
  await page.route('**/api/analyzer/v1/sweeps', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', sweeps: [] },
    }),
  );
  await page.route(`**/predictions/${PREDICTION_ID}/descriptor*`, (route) =>
    route.fulfill({ json: DESCRIPTOR }),
  );
  await page.route(`**/predictions/${PREDICTION_ID}/subjects/cases/payload*`, (route) =>
    route.fulfill({ json: CASES }),
  );
  await page.route('**/subjects/cost-tree/payload*', (route) => route.fulfill({ json: COST_TREE }));
  await page.route('**/subjects/optimality-kernel-ladder/payload*', (route) => {
    const locked = new URL(route.request().url()).searchParams.get('mode') === 'batch_locked';
    return route.fulfill({
      json: {
        ...LADDER,
        meta: {
          ...LADDER.meta,
          necessary_work_mode: locked ? 'batch_locked' : 'replicated_large_batch',
        },
      },
    });
  });
  await page.route('**/subjects/optimality-waterfall/payload*', (route) => {
    const locked = new URL(route.request().url()).searchParams.get('mode') === 'batch_locked';
    return route.fulfill({
      json: {
        ...WATERFALL,
        meta: {
          ...WATERFALL.meta,
          necessary_work_mode: locked ? 'batch_locked' : 'replicated_large_batch',
        },
      },
    });
  });
  await page.route('**/subjects/scoped-optimality/report*', (route) =>
    route.fulfill({ json: SCOPED }),
  );
  await page.goto(`/#/result/prediction/${PREDICTION_ID}?w=w_main&o.optimality=unlocked`);
}

test('reproduces the timing prediction workbench and stores its mode in Location', async ({
  page,
}) => {
  await openPrediction(page);
  const heading = page.getByRole('heading', { name: 'Timing prediction' });
  await expect(heading).toBeVisible();

  await expect(
    page.getByRole('region', { name: 'Timing prediction iteration picker' }).getByRole('button'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Timing prediction CostTree canvas')).toBeVisible();
  await expect(page.getByText('Optimality waterfall · iter 0')).toBeVisible();
  await page.getByRole('button', { name: 'Batch locked' }).click();
  await expect(page).toHaveURL(/o\.optimality=batch_locked/);
  await page.getByRole('button', { name: 'Scope analysis to attention projection' }).click();
  await expect(page).toHaveURL(/o\.cost-tree-scope=0/);
  await page.getByRole('button', { name: 'Component' }).click();
  await page.getByRole('button', { name: 'Per call' }).click();
  await expect(page).toHaveURL(/o\.ladder-granularity=component/);
  await expect(page).toHaveURL(/o\.ladder-normalization=per_call/);
  await page.getByRole('button', { name: 'Compute' }).click();
  await expect(page.getByText(/resolved attention projection/)).toBeVisible();
  await page.getByTestId('scoped-optimality-card').click();
  await expect(page).toHaveURL(/o\.evidence-panel=scoped-optimality/);
});
