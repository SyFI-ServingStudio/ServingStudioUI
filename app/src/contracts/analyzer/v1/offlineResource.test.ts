import { describe, expect, it } from 'vitest';

import {
  parseHardwareGpu,
  parseKernelMeasurementDescriptor,
  parseKernelProfileCurve,
  parseOfflineCatalogs,
} from './offlineResource';

describe('offline Analyzer resources', () => {
  it('normalizes all three catalogs without inventing conversation identity', () => {
    const resources = parseOfflineCatalogs(
      {
        predictions: [
          {
            workspace_id: 'w_main',
            prediction_id: 'p_one',
            display_name: 'predict',
            selector: 'iter',
            gpu: 'NVIDIA H200',
            case_count: 2,
            status: 'ready',
            updated_at: '2026-08-01T00:00:00Z',
          },
        ],
      },
      {
        kernel_profiles: [
          {
            workspace_id: 'w_main',
            profile_id: `kp_legacy_${'a'.repeat(64)}`,
            display_name: 'profile',
            kernel_kind: 'single_gemm',
            table: 'single_gemm',
            backend: 'torch',
            metric_family: 'compute',
            gpu_observed_name: 'NVIDIA H200',
            gpu_cache_key: 'H200',
            status: 'ready',
            updated_at: '2026-08-01T00:00:00Z',
          },
        ],
      },
      {
        kernel_measurements: [
          {
            workspace_id: 'w_main',
            measurement_id: 'km_one',
            display_name: 'measure',
            kernel_kind: 'single_gemm',
            table: 'single_gemm',
            backend: 'torch',
            metric_family: 'compute',
            gpu_observed_name: 'NVIDIA H200',
            gpu_cache_key: 'H200',
            status: 'ready',
            updated_at: '2026-08-01T00:00:00Z',
          },
        ],
      },
    );
    expect(resources.map((resource) => resource.resourceId)).toEqual([
      'p_one',
      `kp_legacy_${'a'.repeat(64)}`,
      'km_one',
    ]);
    expect(resources[1]).not.toHaveProperty('conversationId');
  });

  it('lists the kinds it could read when another kind is missing', () => {
    const resources = parseOfflineCatalogs(undefined, undefined, undefined, {
      alignments: [
        {
          workspace_id: 'w_main',
          alignment_id: 'al_one',
          display_name: 'align',
          kernel_analysis: 'complete',
          e2e_analysis: 'complete',
          updated_at: '2026-08-01T00:00:00Z',
        },
      ],
    });
    expect(resources.map((resource) => resource.resourceId)).toEqual(['al_one']);
  });

  it('retains Analyzer hardware limits on profile rows', () => {
    const curve = parseKernelProfileCurve({
      schemaVersion: 1,
      resourceKind: 'kernel_profile_curve',
      kernelKind: 'single_gemm',
      table: 'single_gemm',
      backend: 'torch',
      metricFamily: 'compute',
      axes: [{ key: 'm', values: [128] }],
      fixedArgs: { dtype: 'bf16' },
      layout: { xAxis: 'm', yAxis: null, facets: [] },
      series: [{ metric: 'tflops', unit: 'TFLOP/s', lowerIsBetter: false }],
      rows: [
        {
          index: 0,
          coordinates: { m: 128 },
          args: { m: 128, dtype: 'bf16' },
          status: 'ready',
          metrics: { tflops: 30 },
          hardware: { tflops_limit: { available: true, limit: 989, basis: 'catalog_peak' } },
        },
      ],
    });
    expect(curve.rows[0]?.hardware?.tflops_limit).toMatchObject({ limit: 989 });
  });

  it('resolves only descriptor-declared measurement plots against Analyzer', () => {
    const descriptor = parseKernelMeasurementDescriptor(
      {
        workspace_id: 'w_main',
        measurement_id: 'km_one',
        display_name: 'measure',
        legacy: false,
        created_at: null,
        kernel: {
          kind: 'single_gemm',
          table: 'single_gemm',
          backend: 'torch',
          metric_family: 'compute',
        },
        gpu: { cache_key: 'H200', observed_name: 'NVIDIA H200', count: 1 },
        shape: { m: 128 },
        duration_s: 5,
        telemetry: true,
        lifecycle: { measurement: 'complete' },
        resources: {
          summary_href: 'kernel-measurements/km_one/summary',
          plots: ['kernel-measurements/km_one/plots/runtime_trend.png'],
        },
      },
      new URL('http://analyzer.test/api/v1/'),
    );
    expect(descriptor.plotUrls).toEqual([
      'http://analyzer.test/api/v1/kernel-measurements/km_one/plots/runtime_trend.png',
    ]);
  });

  it('preserves catalog directionality for interconnect bandwidth', () => {
    const hardware = parseHardwareGpu({
      schema_version: 1,
      requested: 'H200',
      matched: true,
      available: true,
      canonical_name: 'NVIDIA H200',
      matched_alias: 'H200',
      provenance: 'catalog',
      peaks: {
        fp16_tflops: 989,
        bf16_tflops: 989,
        fp8_tflops: 1979,
        fp32_tflops: 67,
        int8_tops: 1979,
      },
      hbm_bandwidth_gbps: 4800,
      interconnect: { name: 'NVLink', bidirectional_gbps: 900, one_way_gbps: 450 },
    });
    expect(hardware.interconnect).toMatchObject({ bidirectionalGbps: 900, oneWayGbps: 450 });
  });
});
