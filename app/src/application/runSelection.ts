import type { KvSeries, PendingQueueSeries, Run, UtilSeries, WorkerRow } from '../domain/run';
import type { CostNode } from '../data/tree';
import {
  iterationsFor,
  nearestIter,
  treeAtIter,
  type Iteration,
  type IterTimeline,
} from '../data/iterations';
import type { VizState } from '../store';

export interface ScopedPendingQueueSeries {
  key: string;
  label: string;
  pending: number[];
}

export interface ScopedPendingQueue {
  t_ms: number[];
  totalLabel: string;
  total: number[];
  series: ScopedPendingQueueSeries[];
  stacked: boolean;
}

export const currentWorker = (run: Run, state: VizState): WorkerRow => {
  const worker =
    run.workerList.find((candidate) => candidate.key === state.workerKey) ?? run.workerList[0];
  if (!worker) throw new Error(`Run ${run.id} has no workers.`);
  return worker;
};

export const poolInScope = (run: Run, state: VizState): string | null => {
  if (state.poolRole) return state.poolRole;
  if (state.scope === 'worker' || state.scope === 'kernel' || state.scope === 'parallel') {
    return currentWorker(run, state).pool;
  }
  return null;
};

function matchesPool(
  key: string | undefined,
  label: string | undefined,
  role: string,
  poolTag?: string,
): boolean {
  if (poolTag !== undefined) return poolTag === role;
  const normalizedKey = (key ?? '').toLowerCase();
  const normalizedLabel = (label ?? '').toLowerCase();
  return normalizedKey.includes(role) || normalizedLabel.includes(role);
}

export const scopedUtil = (run: Run, state: VizState): UtilSeries => {
  const utilization = run.payloads.utilization;
  const role = poolInScope(run, state);
  if (!role) return utilization;
  return {
    t_ms: utilization.t_ms,
    series: utilization.series.filter((series) =>
      matchesPool(series.key, series.label, role, series.poolTag),
    ),
  };
};

export const scopedKv = (run: Run, state: VizState): KvSeries => {
  const kv = run.payloads.kv;
  const role = poolInScope(run, state);
  if (!role) return kv;
  return {
    t_ms: kv.t_ms,
    series: kv.series.filter((series) =>
      matchesPool(undefined, series.label, role, series.poolTag),
    ),
  };
};

function sumPendingQueue(series: PendingQueueSeries[], sampleCount: number): number[] {
  return Array.from({ length: sampleCount }, (_, index) =>
    series.reduce((sum, worker) => sum + (worker.pending[index] ?? 0), 0),
  );
}

/** Queue payloads are stored per worker. This selector is the only owner of
 * pool/cluster aggregation, so totals cannot drift from their components. */
export const scopedPendingQueue = (run: Run, state: VizState): ScopedPendingQueue => {
  const queue = run.payloads.pendingQueue;
  if (!queue) return { t_ms: [], totalLabel: '', total: [], series: [], stacked: false };

  const sampleCount = queue.t_ms.length;
  if (state.scope === 'worker' || state.scope === 'kernel' || state.scope === 'parallel') {
    const selectedWorker = currentWorker(run, state);
    const worker = queue.series.find((item) => item.key === selectedWorker.key);
    return {
      t_ms: queue.t_ms,
      totalLabel: selectedWorker.id,
      total: worker?.pending ?? [],
      series: worker
        ? [{ key: worker.key, label: worker.worker.workerId, pending: worker.pending }]
        : [],
      stacked: false,
    };
  }

  if (state.scope === 'pool') {
    const role = poolInScope(run, state);
    const workers = queue.series.filter((item) => item.worker.poolTag === role);
    return {
      t_ms: queue.t_ms,
      totalLabel: `${role ?? 'unknown'} pool total`,
      total: sumPendingQueue(workers, sampleCount),
      series: workers.map((worker) => ({
        key: worker.key,
        label: worker.worker.workerId,
        pending: worker.pending,
      })),
      stacked: true,
    };
  }

  return {
    t_ms: queue.t_ms,
    totalLabel: 'cluster total',
    total: sumPendingQueue(queue.series, sampleCount),
    series: queue.series.map((worker) => ({
      key: worker.key,
      label: `${worker.worker.poolTag} / ${worker.worker.workerId}`,
      pending: worker.pending,
    })),
    stacked: true,
  };
};

export const cursorSeconds = (state: VizState): number | undefined =>
  state.cursorMs == null ? undefined : state.cursorMs / 1000;

export const iterTimeline = (run: Run, state: VizState): IterTimeline =>
  iterationsFor(run, currentWorker(run, state).key);

export const currentIter = (run: Run, state: VizState): Iteration | null =>
  state.cursorMs == null ? null : nearestIter(iterTimeline(run, state), state.cursorMs);

// Cache by resolved iteration rather than raw cursor so nearby cursor values
// reuse one immutable tree projection.
const treeCache = new Map<string, CostNode>();

export const workerTree = (run: Run, state: VizState): CostNode => {
  const worker = currentWorker(run, state);
  if (!run.capabilities.workerIterations) return worker.tree;
  const iteration = currentIter(run, state);
  const key = `${run.id}:${worker.key}:${iteration ? iteration.id : 'all'}`;
  let tree = treeCache.get(key);
  if (!tree) {
    tree = treeAtIter(worker.tree, iteration, iterTimeline(run, state).ref);
    treeCache.set(key, tree);
  }
  return tree;
};
