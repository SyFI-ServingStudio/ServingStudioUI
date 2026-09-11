import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchArtifact } from './client';
import {
  hardwareGpuRef,
  kernelMeasurementDescriptorRef,
  kernelMeasurementSummaryRef,
  kernelProfileCurveRef,
  kernelProfileDescriptorRef,
} from './ref';

const PROFILE = { kind: 'kernelProfile', id: 'kp_one', workspace: 'w_main' } as const;
const MEASUREMENT = { kind: 'kernelMeasurement', id: 'km_one', workspace: 'w_main' } as const;

function response(body: unknown, etag = '"offline-rev"') {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', etag },
  });
}

function profileDescriptor(workspace = 'w_main') {
  return {
    schema_version: 1,
    workspace_id: workspace,
    profile_id: 'kp_one',
    display_name: 'Profile one',
    legacy: false,
    mode: 'jit-fill',
    created_at: null,
    kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metric_family: 'compute' },
    gpu: { cache_key: 'H200', observed_name: 'NVIDIA H200', count: 1 },
    gpu_provenance: { source: 'measurement' },
    lifecycle: { profile: 'complete' },
  };
}

const CURVE = {
  schemaVersion: 1,
  resourceKind: 'kernel_profile_curve',
  kernelKind: 'gemm',
  table: 'single_gemm',
  backend: 'torch',
  metricFamily: 'compute',
  axes: [{ key: 'm', values: [128] }],
  fixedArgs: { dtype: 'bf16' },
  layout: { xAxis: 'm', yAxis: null, facets: [] },
  series: [{ metric: 'time_ms', unit: 'ms', lowerIsBetter: true }],
  rows: [
    { index: 0, coordinates: { m: 128 }, args: { m: 128 }, status: 'ok', metrics: { time_ms: 1 } },
  ],
};

const MEASUREMENT_DESCRIPTOR = {
  schema_version: 1,
  workspace_id: 'w_main',
  measurement_id: 'km_one',
  display_name: 'Measurement one',
  legacy: false,
  created_at: null,
  kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metric_family: 'compute' },
  gpu: { cache_key: 'H200', observed_name: 'NVIDIA H200', count: 1 },
  shape: { m: 128 },
  duration_s: 5,
  telemetry: true,
  lifecycle: { measurement: 'complete' },
  resources: { summary: { views: ['report'] }, plots: ['runtime trend.png'] },
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

afterEach(() => vi.unstubAllGlobals());

describe('offline artifact client', () => {
  it('decodes the profile documents and rejects a descriptor from another workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(profileDescriptor()))
        .mockResolvedValueOnce(response(CURVE)),
    );
    await expect(fetchArtifact(kernelProfileDescriptorRef(PROFILE))).resolves.toMatchObject({
      status: 'ready',
      revision: 'offline-rev',
      value: { profileId: 'kp_one', provenanceSource: 'measurement' },
    });
    await expect(fetchArtifact(kernelProfileCurveRef(PROFILE))).resolves.toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      value: { rows: [{ metrics: { time_ms: 1 } }] },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(profileDescriptor('w_other'))));
    await expect(fetchArtifact(kernelProfileDescriptorRef(PROFILE))).resolves.toMatchObject({
      status: 'incompatible',
      issues: [expect.stringContaining('w_main/kp_one')],
    });
  });

  it('decodes measurement summary, same-origin plot URLs, and hardware identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(MEASUREMENT_DESCRIPTOR))
        .mockResolvedValueOnce(
          response({ schema_version: 1, runtime_ms: { median: 1.25 }, telemetry: null }),
        )
        .mockResolvedValueOnce(response(HARDWARE)),
    );
    await expect(fetchArtifact(kernelMeasurementDescriptorRef(MEASUREMENT))).resolves.toMatchObject(
      {
        status: 'ready',
        value: {
          measurementId: 'km_one',
          plotUrls: [
            expect.stringMatching(/\/kernel-measurements\/km_one\/plots\/runtime%20trend\.png$/),
          ],
        },
      },
    );
    await expect(fetchArtifact(kernelMeasurementSummaryRef(MEASUREMENT))).resolves.toMatchObject({
      status: 'ready',
      value: { runtimeMs: { median: 1.25 } },
    });
    await expect(fetchArtifact(hardwareGpuRef('NVIDIA H200'))).resolves.toMatchObject({
      status: 'ready',
      value: { hbmBandwidthGbps: 4800 },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...HARDWARE, requested: 'B200' })));
    await expect(fetchArtifact(hardwareGpuRef('NVIDIA H200'))).resolves.toMatchObject({
      status: 'incompatible',
    });
  });

  it.each([
    [kernelProfileDescriptorRef(PROFILE), { ...profileDescriptor(), schema_version: 7 }],
    [kernelProfileCurveRef(PROFILE), { ...CURVE, schemaVersion: 7 }],
    [kernelMeasurementDescriptorRef(MEASUREMENT), { ...MEASUREMENT_DESCRIPTOR, schema_version: 7 }],
    [
      kernelMeasurementSummaryRef(MEASUREMENT),
      { schema_version: 7, runtime_ms: { median: 1.25 }, telemetry: null },
    ],
    [hardwareGpuRef('NVIDIA H200'), { ...HARDWARE, schema_version: 7 }],
  ] as const)('maps an unsupported offline schema to incompatible', async (ref, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));

    await expect(fetchArtifact(ref)).resolves.toMatchObject({
      status: 'incompatible',
      received: 7,
    });
  });

  it('maps Analyzer artifact_missing problem responses to not_generated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            title: 'Artifact missing',
            code: 'artifact_missing',
            detail: 'The curve was not generated.',
          }),
          {
            status: 404,
            statusText: 'Not Found',
            headers: { 'content-type': 'application/problem+json' },
          },
        ),
      ),
    );

    await expect(fetchArtifact(kernelProfileCurveRef(PROFILE))).resolves.toEqual({
      status: 'not_generated',
      reason: 'The curve was not generated.',
    });
  });

  it('rethrows an abort while reading a problem response body', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const json = () =>
          new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener('abort', abort, { once: true });
          });
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json,
        } as unknown as Response;
      }),
    );

    const read = fetchArtifact(kernelProfileCurveRef(PROFILE), controller.signal);
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });
});
