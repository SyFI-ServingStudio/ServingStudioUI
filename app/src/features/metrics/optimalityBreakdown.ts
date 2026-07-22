import { OPTIMALITY_EPSILON_GPU_S, type OptimalityLevel } from '../../domain/optimality';
import type { SubjectResult } from '../../domain/subject';
import type { WorkerKey } from '../../domain/worker';
import type { OptimalityStackRow } from './optimalityOption';

export interface ReadyOptimalityBreakdown {
  status: 'ready';
  rows: OptimalityStackRow[];
  /** hardware-optimal / Real of the primary (first) row — the scope headline. */
  optimalityRatio: number;
  necessaryRatio: number | null;
  gpuName: string;
  gpuSpecMatched: string | null;
  peaksSource: string;
}

export type OptimalityScope =
  | { kind: 'cluster' }
  | { kind: 'pool'; poolTag: string }
  | { kind: 'worker'; workerKey: WorkerKey };

type OptimalityNotReady = Exclude<SubjectResult<'optimality'>, { status: 'ready' }>;

export type OptimalityBreakdownProjection =
  ReadyOptimalityBreakdown | OptimalityNotReady | { status: 'scope_missing'; reason: string };

export function hasReportableOptimality(projection: ReadyOptimalityBreakdown): boolean {
  return projection.rows.some((row) => row.total > OPTIMALITY_EPSILON_GPU_S);
}

function toRow(level: OptimalityLevel): OptimalityStackRow {
  return {
    label: level.label,
    total: level.total,
    // OptimalityBuckets keys are camelCase and match OptimalityFamily.key exactly.
    values: level.buckets as unknown as Record<string, number>,
  };
}

/** A worker level belongs to `poolTag` iff its `pool/worker` key's pool segment
 * decodes to that tag (keys are `encodeURIComponent(pool)/encodeURIComponent(id)`). */
function workerPool(level: OptimalityLevel): string {
  const [pool] = level.key.split('/');
  try {
    return decodeURIComponent(pool);
  } catch {
    return pool;
  }
}

/** Select the scope's rows: the scope's own bar plus its immediate children
 * (cluster → each pool; pool → its workers), mirroring kernel-time-share. */
export function projectOptimalityBreakdown(
  subject: SubjectResult<'optimality'>,
  scope: OptimalityScope,
): OptimalityBreakdownProjection {
  if (subject.status !== 'ready') return subject;
  const payload = subject.payload;

  const levels = payload.levels;
  const rowsForScope = (): OptimalityLevel[] => {
    if (scope.kind === 'cluster') {
      const cluster = levels.filter((level) => level.level === 'cluster');
      const pools = levels.filter((level) => level.level === 'pool');
      return [...cluster, ...pools];
    }
    if (scope.kind === 'pool') {
      const pool = levels.find((level) => level.level === 'pool' && level.key === scope.poolTag);
      if (!pool) return [];
      const workers = levels.filter(
        (level) => level.level === 'worker' && workerPool(level) === scope.poolTag,
      );
      return [pool, ...workers];
    }
    const worker = levels.find(
      (level) => level.level === 'worker' && level.key === scope.workerKey,
    );
    return worker ? [worker] : [];
  };

  const scopeLevels = rowsForScope();
  if (scopeLevels.length === 0) {
    const identity =
      scope.kind === 'pool'
        ? `pool named ${scope.poolTag}`
        : scope.kind === 'worker'
          ? `worker ${scope.workerKey}`
          : 'cluster scope';
    return { status: 'scope_missing', reason: `Optimality payload has no ${identity}.` };
  }

  return {
    status: 'ready',
    rows: scopeLevels.map(toRow),
    optimalityRatio: scopeLevels[0].optimalityRatio,
    // Presence is a payload-wide contract. Do not reinterpret the legacy R5
    // optimality ratio as a global necessary-work result in locked mode.
    necessaryRatio: payload.necessaryRatio,
    gpuName: payload.gpuName,
    gpuSpecMatched: payload.gpuSpecMatched,
    peaksSource: payload.peaksSource,
  };
}

export interface ReadyOptimalityKernels {
  status: 'ready';
  rows: OptimalityStackRow[];
}

export type OptimalityKernelsProjection =
  ReadyOptimalityKernels | OptimalityNotReady | { status: 'scope_missing'; reason: string };

/** The per-kernel bars: each location's Real split into batching / communication /
 * hardware-gap / hardware-optimal (already top-N + `other` from the analyzer). */
export function projectOptimalityKernels(
  subject: SubjectResult<'optimality'>,
): OptimalityKernelsProjection {
  if (subject.status !== 'ready') return subject;
  const kernels = subject.payload.kernels;
  if (kernels.length === 0) {
    return { status: 'scope_missing', reason: 'Optimality payload has no per-kernel breakdown.' };
  }
  return {
    status: 'ready',
    rows: kernels.map((kernel) => ({
      label: kernel.name,
      total: kernel.real,
      values: kernel.buckets as unknown as Record<string, number>,
    })),
  };
}

export function hasReportableKernels(projection: ReadyOptimalityKernels): boolean {
  return projection.rows.some((row) => row.total > OPTIMALITY_EPSILON_GPU_S);
}
