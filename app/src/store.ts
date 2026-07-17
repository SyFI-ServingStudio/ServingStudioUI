/*
 * store.ts — app state (zustand). Holds the Run ▸ Pool ▸ Worker ▸ Kernel drill
 * selection. Server data and ephemeral chart snapshots live outside Zustand.
 */
import { create } from 'zustand';
import { makeWorkerKey, type WorkerKey, type WorkerRef } from './domain/worker';
import type { OperationRef, OperationSummary } from './domain/workerOperation';

export type Scope = 'cluster' | 'pool' | 'worker' | 'kernel' | 'parallel';

export interface VizState {
  runId: string | null;
  scope: Scope;
  poolRole: string | null;
  workerKey: WorkerKey | null;
  leafId: number | null;
  parId: number | null; // selected Max ("parallel") node id; drives parallel scope
  cursorMs: number | null; // wall-clock cursor (from the Timeline); null = aggregate
  cursorNeedsSeek: boolean; // free cursor has not yet been resolved against the active worker
  operation: OperationRef | null;
  setRun: (runId: string) => void;
  setCluster: () => void;
  selectPool: (role: string) => void;
  selectWorker: (worker: WorkerRef) => void;
  selectKernel: (leafId: number) => void;
  selectParallel: (parId: number) => void;
  setTime: (ms: number | null) => void;
  selectOperation: (operation: OperationSummary) => void;
  selectOperationAtCursor: (operation: OperationSummary) => void;
  clearOperationForSeekResult: () => void;
}

export const useViz = create<VizState>((set) => ({
  runId: null,
  scope: 'cluster',
  poolRole: null,
  workerKey: null,
  leafId: null,
  parId: null,
  cursorMs: null,
  cursorNeedsSeek: false,
  operation: null,

  setRun: (runId) =>
    set({
      runId,
      scope: 'cluster',
      poolRole: null,
      leafId: null,
      parId: null,
      cursorMs: null,
      cursorNeedsSeek: false,
      workerKey: null,
      operation: null,
    }),
  setCluster: () =>
    set({
      scope: 'cluster',
      poolRole: null,
      leafId: null,
      parId: null,
      operation: null,
      cursorNeedsSeek: false,
    }),
  selectPool: (role) =>
    set({
      scope: 'pool',
      poolRole: role,
      leafId: null,
      parId: null,
      operation: null,
      cursorNeedsSeek: false,
    }),
  selectWorker: (worker) =>
    set((state) => ({
      scope: 'worker',
      workerKey: makeWorkerKey(worker),
      poolRole: worker.poolTag,
      leafId: null,
      parId: null,
      operation: null,
      cursorNeedsSeek: state.cursorMs !== null,
    })),
  selectKernel: (leafId) => set({ scope: 'kernel', leafId, parId: null }),
  selectParallel: (parId) => set({ scope: 'parallel', parId, leafId: null }),
  // A free wall-clock cursor starts an asynchronous reverse lookup. Preserve
  // the currently rendered operation until the fused seek+buffer response is
  // ready; the provider then replaces or clears it in the same render as the
  // nearby page, avoiding a destructive loading blink.
  setTime: (ms) =>
    set((state) => ({
      cursorMs: ms,
      cursorNeedsSeek: ms !== null,
      ...(ms === null
        ? {
            operation: null,
            leafId: null,
            parId: null,
            scope: state.scope === 'kernel' || state.scope === 'parallel' ? 'worker' : state.scope,
          }
        : {}),
    })),
  selectOperation: (operation) =>
    set((state) => ({
      operation: operation.ref,
      leafId: null,
      parId: null,
      cursorMs: operation.startMs,
      cursorNeedsSeek: false,
      scope: state.scope === 'kernel' || state.scope === 'parallel' ? 'worker' : state.scope,
    })),
  // A wall-clock seek owns its cursor; resolving an exact operation must not
  // snap that cursor back to the operation start.
  selectOperationAtCursor: (operation) =>
    set((state) => ({
      operation: operation.ref,
      leafId: null,
      parId: null,
      cursorNeedsSeek: false,
      scope: state.scope === 'kernel' || state.scope === 'parallel' ? 'worker' : state.scope,
    })),
  clearOperationForSeekResult: () =>
    set((state) => ({
      operation: null,
      cursorNeedsSeek: false,
      leafId: null,
      parId: null,
      scope: state.scope === 'kernel' || state.scope === 'parallel' ? 'worker' : state.scope,
    })),
}));
