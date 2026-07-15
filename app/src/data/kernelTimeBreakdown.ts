import {
  KERNEL_TIME_EPSILON_MS,
  type KernelTimeComposition,
  type KernelTimeShare,
} from '../domain/kernelTimeShare';
import type { SubjectResult } from '../domain/subject';
import { GROUP, groupOf } from './tree';

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

export type KernelTimeBreakdownScope = { kind: 'cluster' } | { kind: 'pool'; poolTag: string };

type KernelTimeShareNotReady = Exclude<SubjectResult<'kernelTimeShare'>, { status: 'ready' }>;

export type KernelTimeBreakdownProjection =
  ReadyKernelTimeBreakdown | KernelTimeShareNotReady | { status: 'scope_missing'; reason: string };

export function hasReportableKernelTime(projection: ReadyKernelTimeBreakdown): boolean {
  return projection.rows.some((row) => row.total > KERNEL_TIME_EPSILON_MS);
}

function groupTimes(composition: KernelTimeComposition): Record<string, number> {
  const byGroup: Record<string, number> = {};
  composition.segments.forEach((segment) => {
    const group = groupOf(segment.kind);
    byGroup[group] = (byGroup[group] ?? 0) + segment.kernelTimeMs;
  });
  return byGroup;
}

function row(label: string, composition: KernelTimeComposition): KernelStackRow {
  return {
    label,
    total: composition.kernelTimeMs,
    byGroup: groupTimes(composition),
  };
}

/** Preserve analyzer scope semantics. Overall and pool totals already account
 * for worker composition and CostTree critical paths; reconstructing them from
 * visual worker trees or applying GPU weights changes the measured result. */
export function projectKernelTimeBreakdown(
  subject: SubjectResult<'kernelTimeShare'>,
  scope: KernelTimeBreakdownScope,
): KernelTimeBreakdownProjection {
  if (subject.status !== 'ready') return subject;

  const payload = subject.payload;
  const rows: KernelStackRow[] =
    scope.kind === 'cluster'
      ? [row('cluster', payload.overall), ...payload.pools.map((pool) => row(pool.poolTag, pool))]
      : (() => {
          const pool = payload.pools.find((candidate) => candidate.poolTag === scope.poolTag);
          return pool ? [row(pool.poolTag, pool)] : [];
        })();

  if (rows.length === 0 && scope.kind === 'pool') {
    return {
      status: 'scope_missing',
      reason: `Kernel-time-share payload has no pool named ${scope.poolTag}.`,
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

  return {
    status: 'ready',
    families,
    rows,
    kernelTimeTotalsExact: true,
    positionMixExact: payload.sampling.positionMixExact,
    sampling: payload.sampling,
  };
}
