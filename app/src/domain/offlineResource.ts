export type OfflineResourceKind =
  'timing_predict' | 'kernel_profile' | 'kernel_measure' | 'alignment';

export interface OfflineResourceCatalogItem {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly kind: OfflineResourceKind;
  readonly displayName: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly kernelKind?: string;
  readonly table?: string;
  readonly backend?: string;
  readonly metricFamily?: string;
  readonly gpuName?: string;
  readonly selector?: string;
  readonly caseCount?: number;
  /** Alignment bundles carry two independent analysis halves, either of which
   * may be missing. A single `status` would have to pick one to report. */
  readonly analysisHalves?: readonly { readonly name: string; readonly status: string }[];
}

export interface KernelIdentity {
  readonly kind: string | null;
  readonly table: string | null;
  readonly backend: string | null;
  readonly metricFamily: string | null;
}

export interface KernelGpuIdentity {
  readonly cacheKey: string | null;
  readonly observedName: string | null;
  readonly count: number | null;
}

export interface KernelProfileDescriptor {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly legacy: boolean;
  readonly mode: string | null;
  readonly createdAt: string | null;
  readonly kernel: KernelIdentity;
  readonly gpu: KernelGpuIdentity | null;
  readonly provenanceSource: string;
  readonly lifecycle: string;
}

export interface KernelProfileAxis {
  readonly key: string;
  readonly values: readonly unknown[];
}

export interface KernelProfileSeries {
  readonly metric: string;
  readonly unit: string;
  readonly lowerIsBetter: boolean;
}

export interface HardwareLimit {
  readonly limit: number | null;
  readonly available: boolean;
  readonly reason?: string;
  readonly basis?: string;
}

export interface KernelProfileRow {
  readonly index: number;
  readonly coordinates: Readonly<Record<string, unknown>>;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: string;
  readonly metrics: Readonly<Record<string, unknown>> | null;
  readonly hardware?: Readonly<Record<string, HardwareLimit | string | null>>;
}

export interface KernelProfileCurve {
  readonly schemaVersion: 1;
  readonly resourceKind: 'kernel_profile_curve';
  readonly kernelKind: string;
  readonly table: string;
  readonly backend: string;
  readonly metricFamily: string;
  readonly axes: readonly KernelProfileAxis[];
  readonly fixedArgs: Readonly<Record<string, unknown>>;
  readonly layout: {
    readonly xAxis: string | null;
    readonly yAxis: string | null;
    readonly facets: readonly string[];
  };
  readonly series: readonly KernelProfileSeries[];
  readonly rows: readonly KernelProfileRow[];
}

export interface KernelMeasurementDescriptor {
  readonly workspaceId: string;
  readonly measurementId: string;
  readonly displayName: string;
  readonly legacy: boolean;
  readonly createdAt: string | null;
  readonly kernel: KernelIdentity;
  readonly gpu: KernelGpuIdentity;
  readonly shape: Readonly<Record<string, unknown>> | null;
  readonly durationSeconds: number | null;
  readonly telemetry: boolean | null;
  readonly lifecycle: string;
  readonly plotUrls: readonly string[];
}

export interface KernelMeasurementSummary {
  readonly label: string | null;
  readonly shape: Readonly<Record<string, unknown>> | null;
  readonly runtimeMs: Readonly<Record<string, number>>;
  readonly telemetry: Readonly<Record<string, unknown>> | null;
}

export interface HardwareGpu {
  readonly requested: string;
  readonly matched: boolean;
  readonly canonicalName: string | null;
  readonly peaks: Readonly<Record<string, number | null>>;
  readonly hbmBandwidthGbps: number | null;
  readonly interconnect: {
    readonly name: string | null;
    readonly bidirectionalGbps: number | null;
    readonly oneWayGbps: number | null;
  } | null;
}
