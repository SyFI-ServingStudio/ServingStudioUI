import type { Page, Route } from '@playwright/test';

import { expect, test } from './quality.fixture';

const PROFILE_ID = 'kp_one';
const MEASUREMENT_ID = 'km_one';

function catalog(kind: 'profile' | 'measurement') {
  const profile = {
    workspace_id: 'w_main',
    profile_id: PROFILE_ID,
    display_name: 'Profile one',
    status: 'ready',
    updated_at: '2026-09-10T00:00:00Z',
    kernel_kind: 'gemm',
    table: 'single_gemm',
    backend: 'torch',
    metric_family: 'compute',
    gpu_observed_name: 'NVIDIA H200',
    gpu_cache_key: 'H200',
  };
  const measurement = {
    workspace_id: 'w_main',
    measurement_id: MEASUREMENT_ID,
    display_name: 'Measurement one',
    status: 'ready',
    updated_at: '2026-09-10T00:00:00Z',
    kernel_kind: 'gemm',
    table: 'single_gemm',
    backend: 'torch',
    metric_family: 'compute',
    gpu_observed_name: 'NVIDIA H200',
    gpu_cache_key: 'H200',
  };
  return {
    protocol_version: 1,
    generated_at: '2026-09-10T00:00:00Z',
    ...(kind === 'profile'
      ? { kernel_profiles: [profile] }
      : { kernel_measurements: [measurement] }),
  };
}

const PROFILE_DESCRIPTOR = {
  schema_version: 1,
  workspace_id: 'w_main',
  profile_id: PROFILE_ID,
  display_name: 'Profile one',
  legacy: false,
  mode: 'jit-fill',
  created_at: null,
  kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metric_family: 'compute' },
  gpu: { cache_key: 'H200', observed_name: 'NVIDIA H200', count: 1 },
  gpu_provenance: { source: 'measurement' },
  lifecycle: { profile: 'complete' },
};

const PROFILE_CURVE = {
  schemaVersion: 1,
  resourceKind: 'kernel_profile_curve',
  kernelKind: 'gemm',
  table: 'single_gemm',
  backend: 'torch',
  metricFamily: 'compute',
  axes: [{ key: 'm', values: [64, 128] }],
  fixedArgs: { dtype: 'bf16' },
  layout: { xAxis: 'm', yAxis: null, facets: [] },
  series: [
    { metric: 'time_ms', unit: 'ms', lowerIsBetter: true },
    { metric: 'tflops', unit: 'TFLOP/s', lowerIsBetter: false },
  ],
  rows: [
    {
      index: 0,
      coordinates: { m: 64 },
      args: { m: 64 },
      status: 'ok',
      metrics: { time_ms: 1.5, tflops: 80 },
    },
    {
      index: 1,
      coordinates: { m: 128 },
      args: { m: 128 },
      status: 'ok',
      metrics: { time_ms: 2.25, tflops: 110 },
    },
  ],
};

const MEASUREMENT_DESCRIPTOR = {
  schema_version: 1,
  workspace_id: 'w_main',
  measurement_id: MEASUREMENT_ID,
  display_name: 'Measurement one',
  legacy: false,
  created_at: null,
  kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metric_family: 'compute' },
  gpu: { cache_key: 'H200', observed_name: 'NVIDIA H200', count: 1 },
  shape: { m: 128, dtype: 'bf16' },
  duration_s: 5,
  telemetry: true,
  lifecycle: { measurement: 'complete' },
  resources: { summary: { views: ['report'] }, plots: ['runtime.png'] },
};

const HARDWARE = {
  schema_version: 1,
  requested: 'NVIDIA H200',
  matched: true,
  available: true,
  canonical_name: 'NVIDIA H200',
  matched_alias: 'H200',
  provenance: 'catalog',
  peaks: { fp16_tflops: 989 },
  hbm_bandwidth_gbps: 4800,
  interconnect: { name: 'NVLink', bidirectional_gbps: 900, one_way_gbps: 450 },
};

async function fallback(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) => route.fulfill({ status: 404, body: 'no' }));
}

async function openProfile(page: Page): Promise<void> {
  await fallback(page);
  await page.route('**/api/analyzer/v1/sweeps', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', sweeps: [] },
    }),
  );
  await page.route('**/api/analyzer/v1/runs', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', runs: [] },
    }),
  );
  await page.route('**/api/analyzer/v1/kernel-profiles', (route) =>
    route.fulfill({ json: catalog('profile') }),
  );
  await page.route(`**/kernel-profiles/${PROFILE_ID}/descriptor*`, (route) =>
    route.fulfill({ json: PROFILE_DESCRIPTOR }),
  );
  await page.route(`**/kernel-profiles/${PROFILE_ID}/subjects/curve/payload*`, (route) =>
    route.fulfill({ json: PROFILE_CURVE }),
  );
  await page.goto(`/#/result/kernel-profile/${PROFILE_ID}?w=w_main`);
}

async function openMeasurement(page: Page): Promise<void> {
  await fallback(page);
  await page.route('**/api/analyzer/v1/sweeps', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', sweeps: [] },
    }),
  );
  await page.route('**/api/analyzer/v1/runs', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', runs: [] },
    }),
  );
  await page.route('**/api/analyzer/v1/kernel-measurements', (route) =>
    route.fulfill({ json: catalog('measurement') }),
  );
  await page.route(`**/kernel-measurements/${MEASUREMENT_ID}/descriptor*`, (route) =>
    route.fulfill({ json: MEASUREMENT_DESCRIPTOR }),
  );
  await page.route(`**/kernel-measurements/${MEASUREMENT_ID}/subjects/summary/report*`, (route) =>
    route.fulfill({
      json: { schema_version: 1, runtime_ms: { median: 1.25, p99: 1.8 }, telemetry: null },
    }),
  );
  await page.route('**/api/analyzer/v1/hardware/gpus?*', (route) =>
    route.fulfill({ json: HARDWARE }),
  );
  await page.route(`**/kernel-measurements/${MEASUREMENT_ID}/plots/runtime.png`, (route: Route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.goto(`/#/result/kernel-measurement/${MEASUREMENT_ID}?w=w_main`);
}

test('reproduces the kernel profile curve page and stores evidence selection in Location', async ({
  page,
}) => {
  await openProfile(page);
  const heading = page.getByRole('heading', { name: 'Kernel profile' });
  await expect(heading).toBeVisible();
  await expect(page.getByText('single_gemm')).toBeVisible();
  await expect(page.getByLabel('Fixed kernel parameters')).toContainText('bf16');
  await expect(page.getByRole('img', { name: /Latency.*single_gemm/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Throughput.*single_gemm/ })).toBeVisible();

  await page.locator('[data-evidence-id="panel:kernel-profile:tflops"]').click();
  await expect(page).toHaveURL(/panel=curve/);
  await expect(page).toHaveURL(/o\.metric=tflops/);
  await expect(page.locator('[data-evidence-id="panel:kernel-profile:tflops"]')).toHaveAttribute(
    'data-agent-selected',
    'true',
  );
});

test('reproduces measurement metadata, summary, plot, and mutually exclusive selection', async ({
  page,
}) => {
  await openMeasurement(page);
  const heading = page.getByRole('heading', { name: 'Kernel measurement' });
  await expect(heading).toBeVisible();
  await expect(page.getByText('4800')).toBeVisible();
  await expect(page.getByText('450')).toBeVisible();
  await expect(page.getByText('1.250 ms')).toBeVisible();
  await expect(page.getByRole('img', { name: 'runtime.png' })).toBeVisible();

  await page.locator('[data-evidence-id="panel:kernel-measurement:summary:median"]').click();
  await expect(page).toHaveURL(/panel=summary/);
  await expect(page).toHaveURL(/o\.metric=median/);
  await page.locator('[data-evidence-id="panel:kernel-measurement:plot:runtime.png"]').click();
  await expect(page).toHaveURL(/panel=plot/);
  await expect(page).toHaveURL(/o\.plot=runtime\.png/);
  await expect(page).not.toHaveURL(/o\.metric=/);
});
