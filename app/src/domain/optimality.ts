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
  hardwareOptimal: number;
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
}

export interface OptimalityKernelRungs {
  balanced: number;
  perConfigBest: number;
  ignoreNetwork: number;
  hardwareLimit: number;
}

export interface OptimalityKernelLadderKernel {
  name: string;
  kind: string;
  isComm: boolean;
  rungs: OptimalityKernelRungs;
}

/** One worker's additive kernel contributions across R0-R5. `iterId=null`
 * denotes the run aggregate embedded in the subject; a concrete id is an exact
 * on-demand iteration detail. */
export interface OptimalityKernelLadder {
  worker: { poolTag: string; workerId: string };
  iterId: string | null;
  label: string;
  rungs: OptimalityRungs;
  specialChunks: { idle: number; imbalance: number };
  kernels: OptimalityKernelLadderKernel[];
}

export interface Optimality {
  unit: 'gpu_seconds';
  /** Cluster hardware-optimal / Real — the headline optimality. */
  optimalityRatio: number;
  levels: OptimalityLevel[];
  kernels: OptimalityKernel[];
  workerKernelLadders: OptimalityKernelLadder[];
  gpuName: string;
  gpuSpecMatched: string | null;
  /** Provenance of the R3 batching ceiling: `sidecar` / `generated` / `unavailable: …`. */
  peaksSource: string;
}
