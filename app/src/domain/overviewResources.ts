export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The model file remains an independent resource; topology owns deployment
 * shape and never absorbs checkpoint configuration fields. */
export interface ModelConfigResource {
  schemaVersion: 1;
  sourcePath: string;
  config: Readonly<Record<string, JsonValue>>;
}

export interface WorkloadOverviewResource {
  schemaVersion: 1;
  scope: 'configured_trace';
  sourcePaths: readonly string[];
  requestCount: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  arrivalBasis: 'effective_open_loop' | 'source_trace';
  requestRate: number;
  tokenLengths: readonly number[];
  inputDensity: readonly number[];
  outputDensity: readonly number[];
  arrivalSeconds: readonly number[];
  arrivals: readonly number[];
  arrivalTrend: readonly number[];
  peakToMean: number;
}

export type OverviewResourceResult<Resource> =
  | { status: 'pending'; reason?: string }
  | { status: 'ready'; resource: Resource }
  | { status: 'not_generated'; reason?: string }
  | { status: 'failed'; code: string; reason: string }
  | { status: 'incompatible'; reason: string };
