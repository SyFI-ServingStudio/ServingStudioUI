/** UI-independent projection of analyzer `optimality` schema v1.
 *
 * The subject measures distance from optimal GPU usage as a ladder of idealized
 * lower bounds; the UI consumes the telescoping **buckets** (in GPU·seconds) that
 * sum back to each scope's Real held GPU·s. See analyzer `optimality` subject. */

/** Below this many GPU·seconds a scope has no reportable work. */
export const OPTIMALITY_EPSILON_GPU_S = 1e-9;

export type OptimalityMode = 'unlocked' | 'batch_locked';

/** Telescoping waterfall buckets (GPU·s), top of the Real bar → the floor.
 * They sum to the level's `total`. `idle` is 0 for the iteration level. */
export interface OptimalityBuckets {
  idle: number;
  imbalance: number;
  batching: number;
  communication: number;
  hardwareGap: number;
  /** Plain R5 floor, present as a non-zero value for locked or degraded output. */
  hardwareOptimal: number;
  /** Unlocked-only split of R5 above the segmented per-op roofline. */
  excessOverNecessary: number;
  /** Unlocked-only benefit between segmented and globally fused rooflines. */
  fusion: number;
  /** Unlocked-only roofline after fusing all necessary work in this scope. */
  scopeFusedNecessary: number;
}

export type OptimalityLevelKind = 'cluster' | 'pool' | 'worker' | 'iteration';

export interface OptimalityLevel {
  level: OptimalityLevelKind;
  /** Scope identity (`cluster`, a pool tag, `pool/worker`, or `iteration`). */
  key: string;
  label: string;
  /** Bar length in GPU·s (Real for most levels; Busy for `iteration`). */
  total: number;
  buckets: OptimalityBuckets;
  /** hardware-optimal / total — the fraction that is irreducible optimal work. */
  optimalityRatio: number;
  /** Global necessary work / total when the unlocked labeler succeeded. */
  necessaryRatio: number | null;
}

/** The four leaf-attributable buckets a single kernel (location) can carry. */
export interface OptimalityKernelBuckets {
  batching: number;
  communication: number;
  hardwareGap: number;
  hardwareOptimal: number;
}

export interface OptimalityKernel {
  name: string;
  kind: string;
  isComm: boolean;
  /** Balanced Real GPU·s of this location (sums the four buckets). */
  real: number;
  buckets: OptimalityKernelBuckets;
}

export interface OptimalityRungs {
  real: number;
  busy: number;
  balanced: number;
  perConfigBest: number;
  ignoreNetwork: number;
  hardwareLimit: number;
  /** Location-attributed segmented necessary-work R6. */
  segmentedNecessary?: number | null;
  /** R7 scope-fused necessary-work floor; aggregate-only, not per-location. */
  scopeFusedNecessary?: number | null;
}

export interface OptimalityKernelRungs {
  balanced: number;
  perConfigBest: number;
  ignoreNetwork: number;
  hardwareLimit: number;
  necessaryLimit?: number | null;
}

export interface OptimalityKernelNecessaryWork {
  semantics: string[];
  minFlops: number;
  minBytes: number;
  computeGpuSeconds: number;
  memoryGpuSeconds: number;
  necessaryGpuSeconds: number;
  /** Defined for one worker/iteration; aggregate GPU work has no additive wall time. */
  wallSeconds: number | null;
  redundantGpuSeconds: number;
  underAccountedGpuSeconds: number;
  underAccountedRawGpuSeconds: number;
  accountingToleranceGpuSeconds: number;
  bound: 'compute' | 'memory';
}

export interface OptimalityKernelLadderKernel {
  name: string;
  kind: string;
  isComm: boolean;
  rungs: OptimalityKernelRungs;
  necessaryWork?: OptimalityKernelNecessaryWork | null;
}

/** Scope-independent kernel ladder data. Identity belongs in the extending
 * worker/iteration or pool/cluster type, never in fabricated placeholder fields. */
export interface OptimalityKernelLadderData {
  label: string;
  rungs: OptimalityRungs;
  specialChunks: { idle: number; imbalance: number; fusion?: number };
  kernels: OptimalityKernelLadderKernel[];
  necessaryWorkMode?: 'batch_locked' | 'replicated_large_batch' | null;
  necessaryWorkReplicationFactor?: number | null;
}

/** One worker's analyzer-owned kernel contributions across R0-R7. `iterId=null`
 * denotes the run aggregate embedded in the subject; a concrete id is an exact
 * on-demand iteration detail. */
export interface OptimalityKernelLadder extends OptimalityKernelLadderData {
  worker: { poolTag: string; workerId: string };
  iterId: string | null;
}

export interface OptimalityAggregateKernelLadder extends OptimalityKernelLadderData {
  level: 'cluster' | 'pool';
  key: string;
}

/** Exact all-row waterfall for one selected worker iteration. This is separate
 * from the kernel ladder because necessary-work floors have no leaf attribution. */
export interface OptimalityIterationWaterfall {
  worker: { poolTag: string; workerId: string };
  iterId: string;
  level: OptimalityLevel;
  gpuName: string;
  gpuSpecMatched: string | null;
  peaksSource: string;
  necessaryWorkMode: 'batch_locked' | 'replicated_large_batch' | null;
  necessaryWorkReplicationFactor: number | null;
}

export interface Optimality {
  unit: 'gpu_seconds';
  /** Cluster hardware-optimal / Real — the headline optimality. */
  optimalityRatio: number;
  /** Cluster global necessary work / Real; null for locked or degraded output. */
  necessaryRatio: number | null;
  levels: OptimalityLevel[];
  kernels: OptimalityKernel[];
  workerKernelLadders: OptimalityKernelLadder[];
  /** Analyzer-owned cluster/pool rollups; the UI must not recompute these. */
  aggregateKernelLadders: OptimalityAggregateKernelLadder[];
  gpuName: string;
  gpuSpecMatched: string | null;
  /** Provenance of the R3 batching ceiling: `sidecar` / `generated` / `unavailable: …`. */
  peaksSource: string;
}
