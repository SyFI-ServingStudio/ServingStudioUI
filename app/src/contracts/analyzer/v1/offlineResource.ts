import { z } from 'zod';

import type {
  HardwareGpu,
  KernelMeasurementDescriptor,
  KernelMeasurementSummary,
  KernelProfileCurve,
  KernelProfileDescriptor,
  OfflineResourceCatalogItem,
} from '../../../domain/offlineResource';

const nullableString = z.string().nullable();
const nullableNumber = z.number().finite().nullable();
const record = z.record(z.unknown());
const resourceId = z
  .string()
  .regex(/^(?:p_[a-z0-9_]{1,64}|(?:kp|km)_(?:[a-z0-9_]{1,64}|legacy_[a-f0-9]{64}))$/);

const catalogBase = z.object({
  workspace_id: z.string(),
  display_name: z.string(),
  status: z.string(),
  updated_at: z.string(),
});

export function parseOfflineCatalogs(
  predictionsInput: unknown,
  profilesInput: unknown,
  measurementsInput: unknown,
): readonly OfflineResourceCatalogItem[] {
  const predictions = z
    .object({
      predictions: z.array(
        catalogBase.extend({
          prediction_id: resourceId,
          selector: z.string(),
          gpu: z.string(),
          case_count: z.number().int().nonnegative(),
        }),
      ),
    })
    .parse(predictionsInput)
    .predictions.map((entry) => ({
      workspaceId: entry.workspace_id,
      resourceId: entry.prediction_id,
      kind: 'timing_predict' as const,
      displayName: entry.display_name,
      status: entry.status,
      updatedAt: entry.updated_at,
      selector: entry.selector,
      gpuName: entry.gpu,
      caseCount: entry.case_count,
    }));
  const profiles = z
    .object({
      kernel_profiles: z.array(
        catalogBase.extend({
          profile_id: resourceId,
          kernel_kind: z.string(),
          table: z.string(),
          backend: z.string(),
          metric_family: z.string(),
          gpu_observed_name: nullableString,
          gpu_cache_key: nullableString,
        }),
      ),
    })
    .parse(profilesInput)
    .kernel_profiles.map((entry) => ({
      workspaceId: entry.workspace_id,
      resourceId: entry.profile_id,
      kind: 'kernel_profile' as const,
      displayName: entry.display_name,
      status: entry.status,
      updatedAt: entry.updated_at,
      kernelKind: entry.kernel_kind,
      table: entry.table,
      backend: entry.backend,
      metricFamily: entry.metric_family,
      gpuName: entry.gpu_observed_name ?? entry.gpu_cache_key ?? undefined,
    }));
  const measurements = z
    .object({
      kernel_measurements: z.array(
        catalogBase.extend({
          measurement_id: resourceId,
          kernel_kind: z.string(),
          table: z.string(),
          backend: z.string(),
          metric_family: z.string(),
          gpu_observed_name: nullableString,
          gpu_cache_key: nullableString,
        }),
      ),
    })
    .parse(measurementsInput)
    .kernel_measurements.map((entry) => ({
      workspaceId: entry.workspace_id,
      resourceId: entry.measurement_id,
      kind: 'kernel_measure' as const,
      displayName: entry.display_name,
      status: entry.status,
      updatedAt: entry.updated_at,
      kernelKind: entry.kernel_kind,
      table: entry.table,
      backend: entry.backend,
      metricFamily: entry.metric_family,
      gpuName: entry.gpu_observed_name ?? entry.gpu_cache_key ?? undefined,
    }));
  return [...predictions, ...profiles, ...measurements];
}

const kernelIdentity = z.object({
  kind: nullableString,
  table: nullableString,
  backend: nullableString,
  metric_family: nullableString,
});
const gpuIdentity = z.object({
  cache_key: nullableString,
  observed_name: nullableString,
  count: z.number().int().nonnegative().nullable(),
});

export function parseKernelProfileDescriptor(input: unknown): KernelProfileDescriptor {
  const value = z
    .object({
      workspace_id: z.string(),
      profile_id: resourceId,
      display_name: z.string(),
      legacy: z.boolean(),
      mode: nullableString,
      created_at: nullableString,
      kernel: kernelIdentity,
      gpu: gpuIdentity.nullable(),
      gpu_provenance: z.object({ source: z.string() }),
      lifecycle: z.object({ profile: z.string() }),
    })
    .parse(input);
  return {
    workspaceId: value.workspace_id,
    profileId: value.profile_id,
    displayName: value.display_name,
    legacy: value.legacy,
    mode: value.mode,
    createdAt: value.created_at,
    kernel: { ...value.kernel, metricFamily: value.kernel.metric_family },
    gpu:
      value.gpu === null
        ? null
        : {
            cacheKey: value.gpu.cache_key,
            observedName: value.gpu.observed_name,
            count: value.gpu.count,
          },
    provenanceSource: value.gpu_provenance.source,
    lifecycle: value.lifecycle.profile,
  };
}

export function parseKernelProfileCurve(input: unknown): KernelProfileCurve {
  return z
    .object({
      schemaVersion: z.literal(1),
      resourceKind: z.literal('kernel_profile_curve'),
      kernelKind: z.string(),
      table: z.string(),
      backend: z.string(),
      metricFamily: z.string(),
      axes: z.array(z.object({ key: z.string(), values: z.array(z.unknown()) })),
      fixedArgs: record,
      layout: z.object({
        xAxis: nullableString,
        yAxis: nullableString,
        facets: z.array(z.string()),
      }),
      series: z.array(
        z.object({ metric: z.string(), unit: z.string(), lowerIsBetter: z.boolean() }),
      ),
      rows: z.array(
        z.object({
          index: z.number().int(),
          coordinates: record,
          args: record,
          status: z.string(),
          metrics: record.nullable(),
          hardware: record.optional(),
        }),
      ),
    })
    .parse(input) as KernelProfileCurve;
}

export function parseKernelMeasurementDescriptor(
  input: unknown,
  apiBase: URL,
): KernelMeasurementDescriptor {
  const value = z
    .object({
      workspace_id: z.string(),
      measurement_id: resourceId,
      display_name: z.string(),
      legacy: z.boolean(),
      created_at: nullableString,
      kernel: kernelIdentity,
      gpu: gpuIdentity,
      shape: record.nullable(),
      duration_s: nullableNumber,
      telemetry: z.boolean().nullable(),
      lifecycle: z.object({ measurement: z.string() }),
      resources: z.object({ summary_href: z.string(), plots: z.array(z.string()) }),
    })
    .parse(input);
  return {
    workspaceId: value.workspace_id,
    measurementId: value.measurement_id,
    displayName: value.display_name,
    legacy: value.legacy,
    createdAt: value.created_at,
    kernel: { ...value.kernel, metricFamily: value.kernel.metric_family },
    gpu: {
      cacheKey: value.gpu.cache_key,
      observedName: value.gpu.observed_name,
      count: value.gpu.count,
    },
    shape: value.shape,
    durationSeconds: value.duration_s,
    telemetry: value.telemetry,
    lifecycle: value.lifecycle.measurement,
    plotUrls: value.resources.plots.map((href) => new URL(href, apiBase).toString()),
  };
}

export function parseKernelMeasurementSummary(input: unknown): KernelMeasurementSummary {
  const value = z
    .object({
      schema_version: z.literal(1),
      label: nullableString.optional(),
      shape: record.nullable().optional(),
      runtime_ms: z.record(z.number().finite()),
      telemetry: record.nullable().optional(),
    })
    .passthrough()
    .parse(input);
  return {
    label: value.label ?? null,
    shape: value.shape ?? null,
    runtimeMs: value.runtime_ms,
    telemetry: value.telemetry ?? null,
  };
}

export function parseHardwareGpu(input: unknown): HardwareGpu {
  const base = z.object({ requested: z.string(), matched: z.boolean() }).passthrough().parse(input);
  if (!base.matched)
    return {
      requested: base.requested,
      matched: false,
      canonicalName: null,
      peaks: {},
      hbmBandwidthGbps: null,
      interconnect: null,
    };
  const value = z
    .object({
      requested: z.string(),
      matched: z.literal(true),
      canonical_name: z.string(),
      peaks: z.record(nullableNumber),
      hbm_bandwidth_gbps: nullableNumber,
      interconnect: z.object({
        name: nullableString,
        bidirectional_gbps: nullableNumber,
        one_way_gbps: nullableNumber,
      }),
    })
    .parse(input);
  return {
    requested: value.requested,
    matched: true,
    canonicalName: value.canonical_name,
    peaks: value.peaks,
    hbmBandwidthGbps: value.hbm_bandwidth_gbps,
    interconnect: {
      name: value.interconnect.name,
      bidirectionalGbps: value.interconnect.bidirectional_gbps,
      oneWayGbps: value.interconnect.one_way_gbps,
    },
  };
}
