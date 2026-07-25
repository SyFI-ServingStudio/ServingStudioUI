import {
  KERNEL_TIME_EPSILON_MS,
  type AggregateKernelComposition,
  type AggregateWorkerKernelComposition,
  type KernelTimeShare,
} from '../domain/kernelTimeShare';
import type { SubjectResult } from '../domain/subject';
import { GROUP, groupOf } from '../domain/cost-tree';
import type { WorkerKey } from '../domain/worker';

export interface KernelStackFamily {
  group: string;
  label: string;
  color: string;
}

export interface KernelStackRow {
  label: string;
  total: number;
  byGroup: Record<string, number>;
}

export interface ReadyKernelTimeBreakdown {
  status: 'ready';
  families: KernelStackFamily[];
  rows: KernelStackRow[];
  kernelTimeTotalsExact: true;
  positionMixExact: boolean;
  sampling: KernelTimeShare['sampling'];
}

export type KernelTimeBreakdownScope =
  | { kind: 'cluster' }
  | { kind: 'pool'; poolTag: string }
  | { kind: 'worker'; workerKey: WorkerKey };

type KernelTimeShareNotReady = Exclude<SubjectResult<'kernelTimeShare'>, { status: 'ready' }>;

export type KernelTimeBreakdownProjection =
  ReadyKernelTimeBreakdown | KernelTimeShareNotReady | { status: 'scope_missing'; reason: string };

export function hasReportableKernelTime(projection: ReadyKernelTimeBreakdown): boolean {
  return projection.rows.some((row) => row.total > KERNEL_TIME_EPSILON_MS);
}

function groupTimes(composition: AggregateKernelComposition): Record<string, number> {
  const byGroup: Record<string, number> = {};
  composition.segments.forEach((segment) => {
    const group = groupOf(segment.kind);
    byGroup[group] = (byGroup[group] ?? 0) + segment.kernelTimeMs;
  });
  return byGroup;
}

function row(label: string, composition: AggregateKernelComposition): KernelStackRow {
  return {
    label,
    total: composition.kernelTimeMs,
    byGroup: groupTimes(composition),
  };
}

function scopedSampling(
  payload: KernelTimeShare,
  workers: readonly AggregateWorkerKernelComposition[] | null,
): Pick<ReadyKernelTimeBreakdown, 'positionMixExact' | 'sampling'> {
  if (workers === null) {
    return {
      positionMixExact: payload.sampling.positionMixExact,
      sampling: payload.sampling,
    };
  }
  const rawRows = workers.reduce((total, worker) => total + worker.rawRows, 0);
  const sampledRows = workers.reduce((total, worker) => total + worker.sampledRows, 0);
  const positionMixExact = workers.every((worker) => worker.sampledRows === worker.rawRows);
  return {
    positionMixExact,
    sampling: { ...payload.sampling, positionMixExact, rawRows, sampledRows },
  };
}

/** Preserve analyzer scope semantics. Overall, pool, and worker totals already account
 * for worker composition and CostTree critical paths; reconstructing them from
 * visual worker trees or applying GPU weights changes the measured result. */
export function projectKernelTimeBreakdown(
  subject: SubjectResult<'kernelTimeShare'>,
  scope: KernelTimeBreakdownScope,
): KernelTimeBreakdownProjection {
  if (subject.status !== 'ready') return subject;

  const payload = subject.payload;
  const scopedWorkers =
    scope.kind === 'cluster'
      ? null
      : scope.kind === 'pool'
        ? payload.workers.filter((worker) => worker.ref.poolTag === scope.poolTag)
        : payload.workers.filter((worker) => worker.key === scope.workerKey);
  const rows: KernelStackRow[] = (() => {
    if (scope.kind === 'cluster') {
      return [
        row('cluster', payload.overall),
        ...payload.pools.map((pool) => row(pool.poolTag, pool)),
      ];
    }
    if (scope.kind === 'pool') {
      const pool = payload.pools.find((candidate) => candidate.poolTag === scope.poolTag);
      return pool ? [row(pool.poolTag, pool)] : [];
    }
    const worker = scopedWorkers?.[0];
    return worker ? [row(worker.key, worker)] : [];
  })();

  if (rows.length === 0) {
    const identity =
      scope.kind === 'pool'
        ? `pool named ${scope.poolTag}`
        : scope.kind === 'worker'
          ? `worker ${scope.workerKey}`
          : 'cluster scope';
    return {
      status: 'scope_missing',
      reason: `Kernel-time-share payload has no ${identity}.`,
    };
  }

  const overallGroups = groupTimes(payload.overall);
  // Pool cards must not advertise zero-percent families from other pools. The
  // overall weights only stabilize the order of families present in this scope.
  const allGroups = new Set(rows.flatMap((item) => Object.keys(item.byGroup)));
  const families = [...allGroups]
    .sort(
      (left, right) =>
        (overallGroups[right] ?? 0) - (overallGroups[left] ?? 0) || left.localeCompare(right),
    )
    .map((group) => ({ group, label: GROUP[group].label, color: GROUP[group].color }));

  const sampling = scopedSampling(payload, scopedWorkers);
  return {
    status: 'ready',
    families,
    rows,
    kernelTimeTotalsExact: true,
    ...sampling,
  };
}
