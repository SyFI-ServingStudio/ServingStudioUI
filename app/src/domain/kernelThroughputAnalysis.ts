import type { JsonValue } from './cost-tree';
import type { WorkerCostTreeRef } from './workerOperation';

export interface KernelThroughputPoint {
  readonly input: Readonly<Record<string, number>>;
  readonly timeMs: number;
  readonly flops: number;
  readonly bytes: number;
  readonly energyJ: number;
  readonly coverage: number;
}

/** One selected CostTree leaf evaluated through the simulator's authoritative
 * Rust cache over its declared grid. These are modeled cache values, not a
 * second Analyzer-side reconstruction of profile.db rows. */
export interface KernelThroughputAnalysisData {
  readonly schemaVersion: 1;
  readonly leafId: number;
  readonly slot: {
    readonly name: string;
    readonly kind: string;
    readonly kernelConfig: Readonly<Record<string, JsonValue>>;
    readonly backend: string | null;
  };
  readonly exactInput: JsonValue;
  readonly inputFields: readonly string[];
  readonly gridAxes: readonly (readonly number[])[];
  readonly points: readonly KernelThroughputPoint[];
  readonly semantics: 'cache_eval_at_declared_grid';
}

export interface KernelThroughputAnalysis extends WorkerCostTreeRef, KernelThroughputAnalysisData {}
