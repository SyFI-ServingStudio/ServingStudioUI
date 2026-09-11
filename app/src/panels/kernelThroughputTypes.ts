import type { JsonValue, KernelThroughputPoint } from '../artifacts';

/** Fields shared by run and prediction kernel-cache analyses. */
export interface KernelThroughputAnalysisData {
  readonly exactInput: JsonValue;
  readonly inputFields: readonly string[];
  readonly gridAxes: readonly (readonly number[])[];
  readonly points: readonly KernelThroughputPoint[];
  readonly worker?: unknown;
  readonly operation?: unknown;
  readonly predictionId?: string;
  readonly caseId?: string;
  readonly operationId?: string;
}

export type { KernelThroughputPoint };
