import type {
  KvSeries,
  PendingQueue,
  PendingQueueSeries,
  Run,
  UtilSeries,
  WorkerRow,
} from '../domain/run';
import type { Scope } from '../store';
import type { WorkerKey } from '../domain/worker';

/** Minimal serializable projection consumed by run-scoping helpers. Keeping
 * actions/dialog/detail ids out of this contract prevents callers from
 * manufacturing a full Zustand snapshot just to compute a chart scope. */
export interface RunSelection {
  readonly scope: Scope;
  readonly poolRole: string | null;
  readonly workerKey: WorkerKey | null;
  readonly cursorMs: number | null;
}

type WorkerSelection = Pick<RunSelection, 'workerKey'>;
type PoolSelection = Pick<RunSelection, 'scope' | 'poolRole' | 'workerKey'>;
type CursorSelection = Pick<RunSelection, 'cursorMs'>;

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

export const currentWorker = (run: Run, state: WorkerSelection): WorkerRow => {
  if (state.workerKey === null) {
    throw new Error(`Run ${run.id} has no selected worker.`);
  }
  const worker = run.workerList.find((candidate) => candidate.key === state.workerKey);
  if (!worker) {
    throw new Error(`Selected worker ${state.workerKey} is not present in run ${run.id}.`);
  }
  return worker;
};

export const poolInScope = (run: Run, state: PoolSelection): string | null => {
  if (state.poolRole) return state.poolRole;
  if (state.scope === 'worker' || state.scope === 'kernel' || state.scope === 'parallel') {
    return currentWorker(run, state).pool;
  }
  return null;
};

const matchesPool = (poolTag: string | undefined, role: string): boolean => poolTag === role;

export const scopedUtil = (utilization: UtilSeries, role: string | null): UtilSeries => {
  if (!role) return utilization;
  return {
    t_ms: utilization.t_ms,
    series: utilization.series.filter((series) => matchesPool(series.poolTag, role)),
    workerSeries: utilization.workerSeries.filter((series) => series.worker.poolTag === role),
  };
};

export const scopedWorkerUtil = (utilization: UtilSeries, workerKey: WorkerKey): UtilSeries => ({
  t_ms: utilization.t_ms,
  series: [],
  workerSeries: utilization.workerSeries.filter((series) => series.key === workerKey),
});

export const scopedKv = (kv: KvSeries, role: string | null): KvSeries => {
  if (!role) return kv;
  return {
    t_ms: kv.t_ms,
    series: kv.series.filter((series) => matchesPool(series.poolTag, role)),
    workerSeries: kv.workerSeries.filter((series) => series.worker.poolTag === role),
  };
};

export const scopedWorkerKv = (kv: KvSeries, workerKey: WorkerKey): KvSeries => ({
  t_ms: kv.t_ms,
  series: [],
  workerSeries: kv.workerSeries.filter((series) => series.key === workerKey),
});

function sumPendingQueue(series: PendingQueueSeries[], sampleCount: number): number[] {
  return Array.from({ length: sampleCount }, (_, index) =>
    series.reduce((sum, worker) => sum + (worker.pending[index] ?? 0), 0),
  );
}

/** Queue payloads are stored per worker. This selector is the only owner of
 * pool/cluster aggregation, so totals cannot drift from their components. */
export const scopedPendingQueue = (
  queue: PendingQueue,
  run: Run,
  state: RunSelection,
): ScopedPendingQueue => {
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

export const cursorSeconds = (state: CursorSelection): number | undefined =>
  state.cursorMs == null ? undefined : state.cursorMs / 1000;
