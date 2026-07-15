/*
 * store.ts — app state (zustand). Holds the Run ▸ Pool ▸ Worker ▸ Kernel drill
 * selection + which metric (if any) is zoomed into the focus dialog.
 */
import { create } from 'zustand';
import type { EChartsOption } from 'echarts';
import { REAL_RUNS as RUNS } from './data/realRunFixture';
import type { KvSeries, PendingQueueSeries, Run, UtilSeries, WorkerRow } from './domain/run';
import type { WorkerKey } from './domain/worker';
import type { CostNode } from './data/tree';
import { iterationsFor, nearestIter, treeAtIter, type Iteration, type IterTimeline } from './data/iterations';

export type Scope = 'cluster' | 'pool' | 'worker' | 'kernel' | 'parallel';
export type MetricKey = 'slo' | 'throughput' | 'utilization' | 'kv' | 'backpressure';

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

/** A chart snapshot pushed into the zoom dialog (any chart, not just metrics). */
export interface FocusPayload { title: string; caption: string; option: EChartsOption | null; }

export interface VizState {
  runId: string;
  scope: Scope;
  poolRole: string | null;
  workerKey: WorkerKey | null;
  leafId: number | null;
  parId: number | null; // selected Max ("parallel") node id; drives parallel scope
  cursorMs: number | null; // wall-clock cursor (from the Timeline); null = aggregate
  focus: FocusPayload | null;

  setRun: (runId: string) => void;
  setCluster: () => void;
  selectPool: (role: string) => void;
  selectWorker: (workerKey: WorkerKey) => void;
  selectKernel: (leafId: number) => void;
  selectParallel: (parId: number) => void;
  setTime: (ms: number | null) => void;
  openFocus: (p: FocusPayload) => void;
  closeFocus: () => void;
}

function firstWorkerOfPool(run: Run, role: string): WorkerKey {
  const w = run.workerList.find((x) => x.pool === role);
  return (w ?? run.workerList[0]).key;
}

function requireRun(runId: string): Run {
  const run = RUNS.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`Unknown run id: ${runId}`);
  return run;
}

export const useViz = create<VizState>((set, get) => ({
  runId: RUNS[0].id,
  scope: 'cluster',
  poolRole: null,
  workerKey: RUNS[0].workerList[0].key,
  leafId: null,
  parId: null,
  cursorMs: null,
  focus: null,

  setRun: (runId) => {
    const run = RUNS.find((candidate) => candidate.id === runId);
    if (!run) return;
    set({ runId, scope: 'cluster', poolRole: null, leafId: null, parId: null, cursorMs: null, focus: null, workerKey: run.workerList[0].key });
  },
  setCluster: () => set({ scope: 'cluster', poolRole: null, leafId: null, parId: null }),
  selectPool: (role) => {
    const run = requireRun(get().runId);
    set({ scope: 'pool', poolRole: role, leafId: null, parId: null, workerKey: firstWorkerOfPool(run, role) });
  },
  selectWorker: (workerKey) => {
    const run = requireRun(get().runId);
    const worker = run.workerList.find((candidate) => candidate.key === workerKey);
    if (!worker) return;
    set({ scope: 'worker', workerKey, poolRole: worker.pool, leafId: null, parId: null });
  },
  selectKernel: (leafId) => set({ scope: 'kernel', leafId, parId: null }),
  selectParallel: (parId) => set({ scope: 'parallel', parId, leafId: null }),
  setTime: (ms) => set({ cursorMs: ms }),
  openFocus: (p) => set({ focus: p }),
  closeFocus: () => set({ focus: null }),
}));

// ---- derived selectors (pure helpers) --------------------------------------
export const currentRun = (s: VizState): Run => requireRun(s.runId);
export const currentWorker = (s: VizState): WorkerRow => {
  const run = requireRun(s.runId);
  return run.workerList.find((worker) => worker.key === s.workerKey) ?? run.workerList[0];
};
export const poolInScope = (s: VizState): string | null => {
  if (s.poolRole) return s.poolRole;
  if (s.scope === 'worker' || s.scope === 'kernel' || s.scope === 'parallel') return currentWorker(s).pool;
  return null;
};
const matchesPool = (key: string | undefined, label: string | undefined, role: string, poolTag?: string) => {
  if (poolTag !== undefined) return poolTag === role;
  const k = (key ?? '').toLowerCase();
  const l = (label ?? '').toLowerCase();
  return k.indexOf(role) >= 0 || l.indexOf(role) >= 0;
};
export const scopedUtil = (s: VizState): UtilSeries => {
  const u = currentRun(s).payloads.utilization;
  const role = poolInScope(s);
  if (!role) return u;
  const f = u.series.filter((x) => matchesPool(x.key, x.label, role, x.poolTag));
  return { t_ms: u.t_ms, series: f };
};
export const scopedKv = (s: VizState): KvSeries => {
  const k = currentRun(s).payloads.kv;
  const role = poolInScope(s);
  if (!role) return k;
  return { t_ms: k.t_ms, series: k.series.filter((x) => matchesPool(undefined, x.label, role, x.poolTag)) };
};

function sumPendingQueue(series: PendingQueueSeries[], sampleCount: number): number[] {
  return Array.from({ length: sampleCount }, (_, index) =>
    series.reduce((sum, worker) => sum + (worker.pending[index] ?? 0), 0));
}

/** Queue payloads are stored per worker. This selector is the only owner of
 *  pool/cluster aggregation, so totals cannot drift from their components. */
export const scopedPendingQueue = (s: VizState): ScopedPendingQueue => {
  const run = currentRun(s);
  const queue = run.payloads.pendingQueue;
  if (!queue) return { t_ms: [], totalLabel: '', total: [], series: [], stacked: false };

  const sampleCount = queue.t_ms.length;
  if (s.scope === 'worker' || s.scope === 'kernel' || s.scope === 'parallel') {
    const selectedWorker = currentWorker(s);
    const worker = queue.series.find((item) => item.key === selectedWorker.key);
    return {
      t_ms: queue.t_ms,
      totalLabel: selectedWorker.id,
      total: worker?.pending ?? [],
      series: worker ? [{ key: worker.key, label: worker.worker.workerId, pending: worker.pending }] : [],
      stacked: false,
    };
  }

  if (s.scope === 'pool') {
    const role = poolInScope(s);
    const workers = queue.series.filter((item) => item.worker.poolTag === role);
    return {
      t_ms: queue.t_ms,
      totalLabel: `${role ?? 'unknown'} pool total`,
      total: sumPendingQueue(workers, sampleCount),
      series: workers.map((worker) => ({ key: worker.key, label: worker.worker.workerId, pending: worker.pending })),
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

// ---- time / iteration axis (orthogonal to the structural drill) ------------
// Timeline = wall-clock cursor (run-level, exact). Iteration = the CURRENT
// worker's step nearest that cursor (snapped). One source of truth: cursorMs.
export const cursorSeconds = (s: VizState): number | undefined => (s.cursorMs == null ? undefined : s.cursorMs / 1000);
export const iterTimeline = (s: VizState): IterTimeline => iterationsFor(currentRun(s), currentWorker(s).key);
export const currentIter = (s: VizState): Iteration | null =>
  s.cursorMs == null ? null : nearestIter(iterTimeline(s), s.cursorMs);

// cost tree at the resolved iteration (base tree when aggregate); memoised by
// the RESOLVED step id so nearby cursor values reuse one stable tree object
const treeCache = new Map<string, CostNode>();
export const workerTree = (s: VizState): CostNode => {
  const run = currentRun(s);
  const w = currentWorker(s);
  if (!run.capabilities.workerIterations) return w.tree;
  const it = currentIter(s);
  const key = `${run.id}:${w.key}:${it ? it.id : 'all'}`;
  let t = treeCache.get(key);
  if (!t) {
    t = treeAtIter(w.tree, it, iterTimeline(s).ref);
    treeCache.set(key, t);
  }
  return t;
};
