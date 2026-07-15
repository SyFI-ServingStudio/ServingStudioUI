/*
 * store.ts — app state (zustand). Holds the Run ▸ Pool ▸ Worker ▸ Kernel drill
 * selection. Server data and ephemeral chart snapshots live outside Zustand.
 */
import { create } from 'zustand';
import { makeWorkerKey, type WorkerKey, type WorkerRef } from './domain/worker';

export type Scope = 'cluster' | 'pool' | 'worker' | 'kernel' | 'parallel';
export type MetricKey = 'slo' | 'throughput' | 'utilization' | 'kv' | 'backpressure';

export interface VizState {
  runId: string | null;
  scope: Scope;
  poolRole: string | null;
  workerKey: WorkerKey | null;
  leafId: number | null;
  parId: number | null; // selected Max ("parallel") node id; drives parallel scope
  cursorMs: number | null; // wall-clock cursor (from the Timeline); null = aggregate
  setRun: (runId: string) => void;
  setCluster: () => void;
  selectPool: (role: string) => void;
  selectWorker: (worker: WorkerRef) => void;
  selectKernel: (leafId: number) => void;
  selectParallel: (parId: number) => void;
  setTime: (ms: number | null) => void;
}

export const useViz = create<VizState>((set) => ({
  runId: null,
  scope: 'cluster',
  poolRole: null,
  workerKey: null,
  leafId: null,
  parId: null,
  cursorMs: null,

  setRun: (runId) =>
    set({
      runId,
      scope: 'cluster',
      poolRole: null,
      leafId: null,
      parId: null,
      cursorMs: null,
      workerKey: null,
    }),
  setCluster: () => set({ scope: 'cluster', poolRole: null, leafId: null, parId: null }),
  selectPool: (role) => set({ scope: 'pool', poolRole: role, leafId: null, parId: null }),
  selectWorker: (worker) =>
    set({
      scope: 'worker',
      workerKey: makeWorkerKey(worker),
      poolRole: worker.poolTag,
      leafId: null,
      parId: null,
    }),
  selectKernel: (leafId) => set({ scope: 'kernel', leafId, parId: null }),
  selectParallel: (parId) => set({ scope: 'parallel', parId, leafId: null }),
  setTime: (ms) => set({ cursorMs: ms }),
}));
