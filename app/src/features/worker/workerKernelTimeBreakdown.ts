import { GROUP, groupOf } from '../../domain/cost-tree';
import { KERNEL_TIME_EPSILON_MS } from '../../domain/kernelTimeShare';
import type { SubjectResult } from '../../domain/subject';
import type { WorkerKey } from '../../domain/worker';

export interface WorkerKernelPositionShare {
  readonly position: string;
  readonly kind: string;
  readonly timeMs: number;
  readonly sharePct: number;
  readonly color: string;
}

export type WorkerKernelPositionBreakdown =
  | {
      readonly status: 'ready';
      readonly workerKey: WorkerKey;
      readonly totalMs: number;
      readonly positionMixExact: boolean;
      readonly sampledRows: number;
      readonly rawRows: number;
      readonly positions: readonly WorkerKernelPositionShare[];
    }
  | Exclude<SubjectResult<'kernelTimeShare'>, { status: 'ready' }>
  | { readonly status: 'scope_missing'; readonly reason: string };

/** Preserve the analyzer's worker row: its total is exact, while the position
 * mixture may come from the bounded replay sample declared on that same row. */
export function projectWorkerKernelPositions(
  subject: SubjectResult<'kernelTimeShare'>,
  workerKey: WorkerKey,
): WorkerKernelPositionBreakdown {
  if (subject.status !== 'ready') return subject;
  const worker = subject.payload.workers.find((candidate) => candidate.key === workerKey);
  if (!worker) {
    return {
      status: 'scope_missing',
      reason: `Kernel-time-share payload has no worker ${workerKey}.`,
    };
  }

  const positions = worker.segments
    .filter((segment) => segment.kernelTimeMs > KERNEL_TIME_EPSILON_MS)
    .map((segment) => ({
      position: segment.position,
      kind: segment.kind,
      timeMs: segment.kernelTimeMs,
      sharePct:
        worker.kernelTimeMs > KERNEL_TIME_EPSILON_MS
          ? (segment.kernelTimeMs / worker.kernelTimeMs) * 100
          : 0,
      color: GROUP[groupOf(segment.kind)].color,
    }))
    .sort(
      (left, right) => right.timeMs - left.timeMs || left.position.localeCompare(right.position),
    );

  return {
    status: 'ready',
    workerKey,
    totalMs: worker.kernelTimeMs,
    positionMixExact: worker.sampledRows === worker.rawRows,
    sampledRows: worker.sampledRows,
    rawRows: worker.rawRows,
    positions,
  };
}
