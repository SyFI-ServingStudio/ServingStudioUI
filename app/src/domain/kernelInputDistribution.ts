export type KernelInputProjection = 'categorical' | 'feature_1d' | 'raw_2d' | 'pca';

export interface KernelBackendSelection {
  readonly backendIndex: number;
  readonly backendName: string;
  readonly count: number;
  /** Fraction in [0, 1] of sampled executed slots at this position. */
  readonly ratio: number;
}

export interface KernelInputPoint {
  readonly x: number;
  readonly y: number;
  readonly backendIndex: number;
  readonly backendName: string;
  /** Number of sampled slots represented by this deduplicated point. */
  readonly count: number;
}

/** One analyzer scatter keyed by the CostTree leaf's manifest position name. */
export interface KernelInputPosition {
  readonly name: string;
  readonly kind: string;
  readonly candidateBackends: readonly string[];
  readonly selection: readonly KernelBackendSelection[];
  readonly projection: KernelInputProjection;
  readonly axisLabels: readonly [string, string];
  readonly explainedVariance: readonly [number, number] | null;
  readonly points: readonly KernelInputPoint[];
}

export interface KernelInputDistribution {
  readonly positions: readonly KernelInputPosition[];
  readonly sampling: {
    readonly stride: number;
    readonly sampledRows: number;
    readonly maxPointsPerPosition: number;
  };
  readonly definitions: Readonly<Record<string, string>>;
}
