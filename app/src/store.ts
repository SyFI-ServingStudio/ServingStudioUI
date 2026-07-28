/*
 * store.ts — app state (zustand). Holds the shared Aggregate / Run ▸ Pool ▸
 * Worker ▸ Kernel selection consumed by the Analyzer and future Inquiry rail.
 * Server data, panel geometry, drafts, and chart snapshots live elsewhere.
 */
import { create } from 'zustand';
import type {
  AggregateAnalyzerSelectionV2,
  RunAnalyzerSelectionV2,
} from './domain/analyzerSelection';
import { makeWorkerKey, type WorkerKey, type WorkerRef } from './domain/worker';
import type { OperationRef, OperationSummary } from './domain/workerOperation';

export type Scope = 'cluster' | 'pool' | 'worker' | 'kernel' | 'parallel';
export type WorkerAnalysisLevel = 'worker' | 'iteration';
export type AnalyzerSurface = 'aggregate' | 'run';

export interface SetRunOptions {
  readonly keepSelection?: boolean;
  readonly workspaceId?: string;
}

export interface VizState {
  selectionSurface: AnalyzerSurface;
  aggregateSelection: AggregateAnalyzerSelectionV2 | null;
  inquiryId: string | null;
  phaseId: string | null;
  runWorkspaceId: string | null;
  runId: string | null;
  runPanelId: string | null;
  scope: Scope;
  poolRole: string | null;
  workerKey: WorkerKey | null;
  leafId: number | null;
  parId: number | null; // selected Max ("parallel") node id; drives parallel scope
  cursorMs: number | null; // wall-clock cursor (from the Timeline); null = aggregate
  cursorNeedsSeek: boolean; // iteration mode has not resolved the free cursor against the worker
  operation: OperationRef | null;
  workerAnalysisLevel: WorkerAnalysisLevel;
  setSelectionSurface: (surface: AnalyzerSurface) => void;
  setAggregateSelection: (selection: AggregateAnalyzerSelectionV2) => void;
  setInquiryContextIdentity: (inquiryId: string | null, phaseId: string | null) => void;
  setRun: (runId: string, options?: SetRunOptions) => void;
  restoreRunSelection: (selection: RunAnalyzerSelectionV2) => void;
  selectRunPanel: (panelId: string) => void;
  setCluster: () => void;
  selectPool: (role: string) => void;
  selectWorker: (worker: WorkerRef) => void;
  showWorkerAnalysis: () => void;
  showIterationAnalysis: () => void;
  selectKernel: (leafId: number) => void;
  selectParallel: (parId: number) => void;
  setTime: (ms: number | null) => void;
  selectOperation: (operation: OperationSummary) => void;
  selectOperationAtCursor: (operation: OperationSummary) => void;
  clearOperationForSeekResult: () => void;
}

export const useViz = create<VizState>((set) => ({
  selectionSurface: 'aggregate',
  aggregateSelection: null,
  inquiryId: null,
  phaseId: null,
  runWorkspaceId: null,
  runId: null,
  runPanelId: null,
  scope: 'cluster',
  poolRole: null,
  workerKey: null,
  leafId: null,
  parId: null,
  cursorMs: null,
  cursorNeedsSeek: false,
  operation: null,
  workerAnalysisLevel: 'worker',

  setSelectionSurface: (selectionSurface) => set({ selectionSurface }),
  setAggregateSelection: (aggregateSelection) =>
    set({ selectionSurface: 'aggregate', aggregateSelection }),
  setInquiryContextIdentity: (inquiryId, phaseId) => set({ inquiryId, phaseId }),
  selectRunPanel: (runPanelId) => set({ selectionSurface: 'run', runPanelId }),
  setRun: (runId, options) =>
    set(
      options?.keepSelection
        ? {
            runId,
            ...(options.workspaceId === undefined ? {} : { runWorkspaceId: options.workspaceId }),
          }
        : {
            runId,
            runWorkspaceId: options?.workspaceId ?? null,
            runPanelId: null,
            scope: 'cluster',
            poolRole: null,
            leafId: null,
            parId: null,
            cursorMs: null,
            cursorNeedsSeek: false,
            workerKey: null,
            operation: null,
            workerAnalysisLevel: 'worker',
          },
    ),
  restoreRunSelection: (selection) =>
    set({
      selectionSurface: 'run',
      runWorkspaceId: selection.workspaceId,
      runId: selection.runId,
      runPanelId: selection.panelId,
      scope: selection.scope,
      poolRole: selection.poolRole,
      workerKey: selection.workerKey as WorkerKey | null,
      leafId: selection.leafId,
      parId: selection.parId,
      cursorMs: selection.cursorMs,
      cursorNeedsSeek: selection.cursorNeedsSeek,
      operation: selection.operation,
      workerAnalysisLevel: selection.workerAnalysisLevel,
    }),
  setCluster: () =>
    set({
      scope: 'cluster',
      runPanelId: null,
      poolRole: null,
      leafId: null,
      parId: null,
      operation: null,
      cursorNeedsSeek: false,
      workerAnalysisLevel: 'worker',
    }),
  selectPool: (role) =>
    set({
      scope: 'pool',
      runPanelId: null,
      poolRole: role,
      leafId: null,
      parId: null,
      operation: null,
      cursorNeedsSeek: false,
      workerAnalysisLevel: 'worker',
    }),
  selectWorker: (worker) =>
    set({
      scope: 'worker',
      runPanelId: null,
      workerKey: makeWorkerKey(worker),
      poolRole: worker.poolTag,
      leafId: null,
      parId: null,
      operation: null,
      cursorNeedsSeek: false,
      workerAnalysisLevel: 'worker',
    }),
  showWorkerAnalysis: () =>
    set({
      scope: 'worker',
      runPanelId: null,
      workerAnalysisLevel: 'worker',
      operation: null,
      leafId: null,
      parId: null,
      cursorNeedsSeek: false,
    }),
  showIterationAnalysis: () =>
    set((state) => ({
      scope: 'worker',
      runPanelId: null,
      workerAnalysisLevel: 'iteration',
      leafId: null,
      parId: null,
      cursorNeedsSeek: state.operation === null && state.cursorMs !== null,
    })),
  selectKernel: (leafId) =>
    set({
      scope: 'kernel',
      runPanelId: null,
      workerAnalysisLevel: 'iteration',
      leafId,
      parId: null,
    }),
  selectParallel: (parId) =>
    set({
      scope: 'parallel',
      runPanelId: null,
      workerAnalysisLevel: 'iteration',
      parId,
      leafId: null,
    }),
  // A free wall-clock cursor starts an asynchronous reverse lookup. Preserve
  // the currently rendered operation until the fused seek+buffer response is
  // ready; the provider then replaces or clears it in the same render as the
  // nearby page, avoiding a destructive loading blink.
  setTime: (ms) =>
    set((state) => ({
      cursorMs: ms,
      cursorNeedsSeek: ms !== null && state.workerAnalysisLevel === 'iteration',
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
      workerAnalysisLevel: 'iteration',
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
      workerAnalysisLevel: 'iteration',
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
