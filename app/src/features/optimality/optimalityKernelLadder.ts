import type {
  OptimalityKernelLadderData,
  OptimalityKernelLadderKernel,
  OptimalityKernelRungs,
} from '../../domain/optimality';
import { OPTIMALITY_EPSILON_GPU_S } from '../../domain/optimality';
import type { SubjectResult } from '../../domain/subject';
import type { WorkerKey } from '../../domain/worker';
import { makeWorkerKey } from '../../domain/worker';
import type { OptimalityStackRow } from './optimalityOption';

export interface KernelLadderRow {
  label: string;
  total: number;
  values: Record<string, number>;
}

export interface ReadyKernelLadderProjection {
  status: 'ready';
  rows: KernelLadderRow[];
  kernels: OptimalityKernelLadderKernel[];
  kernelNames: string[];
  label: string;
  kernelFilter: string | null;
}

export type KernelLadderProjection =
  | ReadyKernelLadderProjection
  | {
      status: 'pending' | 'unavailable' | 'not_generated' | 'failed' | 'incompatible';
      reason?: string;
      code?: string;
      receivedSchemaVersion?: number;
    }
  | { status: 'scope_missing'; reason: string };

export type KernelLadderScope =
  | { kind: 'cluster' }
  | { kind: 'pool'; poolTag: string }
  | { kind: 'worker'; workerKey: WorkerKey };

export interface ReadyKernelHeadroomProjection {
  status: 'ready';
  rows: OptimalityStackRow[];
  label: string;
  /** Number of lower-ranked locations represented by the final `other` row. */
  collapsedKernelCount: number;
  underAccountedKernelCount: number;
}

export type KernelHeadroomProjection =
  ReadyKernelHeadroomProjection | Exclude<KernelLadderProjection, { status: 'ready' }>;

function ladderRows(
  data: OptimalityKernelLadderData,
  kernelFilter: string | null,
): ReadyKernelLadderProjection {
  const kernels =
    kernelFilter === null
      ? data.kernels
      : data.kernels.filter((kernel) => kernel.name === kernelFilter);
  const kernelNames = kernels.map((kernel) => kernel.name);
  const values = (
    rung: keyof OptimalityKernelRungs,
    includeImbalance: boolean,
    includeIdle: boolean,
  ) => {
    const row: Record<string, number> = {};
    for (const kernel of kernels) row[kernel.name] = kernel.rungs[rung] ?? 0;
    if (kernelFilter === null && includeImbalance) row.__imbalance = data.specialChunks.imbalance;
    if (kernelFilter === null && includeIdle) row.__idle = data.specialChunks.idle;
    return row;
  };
  const makeRow = (label: string, rowValues: Record<string, number>): KernelLadderRow => ({
    label,
    total: Object.values(rowValues).reduce((sum, value) => sum + value, 0),
    values: rowValues,
  });
  const rows = [
    makeRow('R0 Real', values('balanced', true, true)),
    makeRow('R1 Busy', values('balanced', true, false)),
    makeRow('R2 Balanced', values('balanced', false, false)),
    makeRow('R3 Per-config best', values('perConfigBest', false, false)),
    makeRow('R4 Ignore network', values('ignoreNetwork', false, false)),
    makeRow('R5 Hardware limit', values('hardwareLimit', false, false)),
  ];
  if (data.rungs.segmentedNecessary !== null && data.rungs.segmentedNecessary !== undefined) {
    rows.push(makeRow('R6 Segmented necessary', values('necessaryLimit', false, false)));
  }
  if (data.rungs.scopeFusedNecessary !== null && data.rungs.scopeFusedNecessary !== undefined) {
    rows.push(makeRow('R7 Scope fused', { __globalNecessary: data.rungs.scopeFusedNecessary }));
  }
  return {
    status: 'ready',
    label: data.label,
    kernelFilter,
    kernels,
    kernelNames,
    rows,
  };
}

export function projectScopedKernelLadder(
  subject: SubjectResult<'optimality'>,
  scope: KernelLadderScope,
  kernelFilter: string | null = null,
): KernelLadderProjection {
  if (subject.status !== 'ready') return subject;
  const ladder =
    scope.kind === 'cluster'
      ? subject.payload.aggregateKernelLadders.find(
          (candidate) => candidate.level === 'cluster' && candidate.key === 'cluster',
        )
      : scope.kind === 'pool'
        ? subject.payload.aggregateKernelLadders.find(
            (candidate) => candidate.level === 'pool' && candidate.key === scope.poolTag,
          )
        : subject.payload.workerKernelLadders.find(
            (candidate) => makeWorkerKey(candidate.worker) === scope.workerKey,
          );
  if (ladder === undefined) {
    return { status: 'scope_missing', reason: 'No kernel ladder is available for this scope.' };
  }
  return ladderRows(ladder, kernelFilter);
}

export function projectExactKernelLadder(
  ladder: OptimalityKernelLadderData,
  kernelFilter: string | null = null,
): KernelLadderProjection {
  return ladderRows(ladder, kernelFilter);
}

const MAX_HEADROOM_KERNELS = 16;

function kernelHeadroomRow(kernel: OptimalityKernelLadderKernel): OptimalityStackRow {
  const { balanced, perConfigBest, ignoreNetwork, hardwareLimit } = kernel.rungs;
  const necessary = kernel.rungs.necessaryLimit;
  if (necessary !== null && necessary !== undefined) {
    return {
      label: kernel.name,
      total: balanced,
      marker: kernel.necessaryWork?.underAccountedGpuSeconds ? necessary : undefined,
      values: {
        batching: Math.max(0, balanced - perConfigBest),
        communication: Math.max(0, perConfigBest - ignoreNetwork),
        hardwareGap: Math.max(0, ignoreNetwork - hardwareLimit),
        redundant: Math.max(0, hardwareLimit - necessary),
        necessaryCovered: Math.min(hardwareLimit, necessary),
      },
    };
  }
  return {
    label: kernel.name,
    total: balanced,
    values: {
      batching: Math.max(0, balanced - perConfigBest),
      communication: Math.max(0, perConfigBest - ignoreNetwork),
      hardwareGap: Math.max(0, ignoreNetwork - hardwareLimit),
      hardwareOptimal: Math.max(0, hardwareLimit),
    },
  };
}

function collapseHeadroomRows(rows: readonly OptimalityStackRow[]): OptimalityStackRow {
  const values: Record<string, number> = {};
  for (const row of rows) {
    // Optional bucket presence is semantic: absent necessary-work buckets mean
    // the scope must use the R5 hardware-optimal fallback. Do not synthesize
    // zero-valued keys while folding lower-ranked locations into `other`.
    for (const [key, value] of Object.entries(row.values)) {
      values[key] = (values[key] ?? 0) + value;
    }
  }
  return {
    label: 'other',
    total: rows.reduce((sum, row) => sum + row.total, 0),
    values,
  };
}

/** Derive the screenshot-style per-kernel headroom bars from the same scoped
 * R2-R5 ladder used by the rung chart. This keeps cluster, pool, worker,
 * iteration, and selected-kernel views on one additive source of truth. */
export function projectKernelHeadroom(ladder: KernelLadderProjection): KernelHeadroomProjection {
  if (ladder.status !== 'ready') return ladder;
  const rows = ladder.kernels
    .map(kernelHeadroomRow)
    .filter((row) => row.total > OPTIMALITY_EPSILON_GPU_S);
  const underAccountedKernelCount = rows.filter((row) => row.marker !== undefined).length;
  if (rows.length <= MAX_HEADROOM_KERNELS || ladder.kernelFilter !== null) {
    return {
      status: 'ready',
      rows,
      label: ladder.label,
      collapsedKernelCount: 0,
      underAccountedKernelCount,
    };
  }
  const visibleRows = rows.slice(0, MAX_HEADROOM_KERNELS);
  const collapsedRows = rows.slice(MAX_HEADROOM_KERNELS);
  return {
    status: 'ready',
    rows: [...visibleRows, collapseHeadroomRows(collapsedRows)],
    label: ladder.label,
    collapsedKernelCount: collapsedRows.length,
    underAccountedKernelCount,
  };
}
