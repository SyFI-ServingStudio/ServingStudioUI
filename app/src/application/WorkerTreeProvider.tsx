import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { DetailArtifact } from '../domain/artifacts';
import type { CostTree } from '../domain/cost-tree';
import type { Run, WorkerRow } from '../domain/run';
import type { OperationRef, OperationSummary } from '../domain/workerOperation';
import { useViz, type Scope } from '../store';
import {
  useWorkerCostTreeDetailQuery,
  useWorkerOperationBootstrapQuery,
  useWorkerOperationSeekQuery,
  useWorkerOperationsQuery,
} from './queries';
import {
  createOperationViewportState,
  OPERATION_VIEWPORT_SIZE,
  moveOperationViewport,
  resolveOperationBufferRequest,
  shiftOperationViewport,
  type OperationBufferDirection,
  type OperationViewportState,
} from './workerOperationBuffer';

export type WorkerTreeNonReadyStatus =
  'empty' | 'unavailable' | 'not_generated' | 'failed' | 'incompatible';

export type ActiveWorkerTreeState =
  | { status: 'idle'; worker: null; tree: null; error: null; retry: null }
  | { status: 'awaiting-selection'; worker: WorkerRow; tree: null; error: null; retry: null }
  | { status: 'loading'; worker: WorkerRow; tree: null; error: null; retry: null }
  | {
      status: 'ready';
      worker: WorkerRow;
      operation: OperationRef;
      tree: CostTree;
      error: null;
      retry: null;
    }
  | {
      status: 'error';
      worker: WorkerRow | null;
      tree: null;
      error: Error;
      retry: (() => void) | null;
    }
  | {
      status: WorkerTreeNonReadyStatus;
      worker: WorkerRow;
      tree: null;
      reason: string;
      code: string | null;
      retry: (() => void) | null;
    };

export type ActiveWorkerOperationState =
  | { status: 'idle'; worker: null }
  | { status: 'loading'; worker: WorkerRow }
  | {
      status: 'ready';
      worker: WorkerRow;
      viewport: OperationViewportState;
      operations: readonly OperationSummary[];
      selected: OperationSummary | null;
      shift: (direction: OperationBufferDirection) => void;
      navigate: (operationDelta: number) => void;
    }
  | {
      status: WorkerTreeNonReadyStatus | 'error';
      worker: WorkerRow | null;
      reason: string;
      retry: (() => void) | null;
    };

export type ActiveWorkerOperationSeekState =
  | { status: 'idle'; atMs: null; hits: readonly [] }
  | { status: 'loading'; atMs: number; hits: readonly [] }
  | { status: 'ready'; atMs: number; hits: readonly OperationSummary[] }
  | { status: 'error'; atMs: number; hits: readonly []; reason: string };

const WorkerTreeContext = createContext<ActiveWorkerTreeState | null>(null);
const WorkerOperationContext = createContext<ActiveWorkerOperationState | null>(null);
const WorkerOperationSeekContext = createContext<ActiveWorkerOperationSeekState | null>(null);
const SEEK_DEBOUNCE_MS = 150;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

const needsWorkerTree = (scope: Scope): boolean =>
  scope === 'worker' || scope === 'kernel' || scope === 'parallel';
const errorReason = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
const errorCode = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;

function detailFailureStatus(error: unknown): Exclude<WorkerTreeNonReadyStatus, 'empty'> {
  if (typeof error !== 'object' || error === null || !('status' in error)) return 'failed';
  switch (error.status) {
    case 'unavailable':
    case 'not_generated':
    case 'failed':
    case 'incompatible':
      return error.status;
    default:
      return 'failed';
  }
}

function descriptorTreeState(
  worker: WorkerRow,
  name: string,
  detail: DetailArtifact | undefined,
): ActiveWorkerTreeState {
  const status = detail?.status ?? 'not_generated';
  if (status === 'pending')
    return { status: 'loading', worker, tree: null, error: null, retry: null };
  if (status === 'ready') {
    return {
      status: 'incompatible',
      worker,
      tree: null,
      reason: `${name} is ready without a usable protocol identity.`,
      code: null,
      retry: null,
    };
  }
  return {
    status,
    worker,
    tree: null,
    reason:
      detail && 'reason' in detail && detail.reason
        ? detail.reason
        : `Run descriptor does not provide ready ${name}.`,
    code: detail && 'code' in detail ? (detail.code ?? null) : null,
    retry: null,
  };
}

export function ActiveWorkerTreeProvider({
  run,
  workerOperationDetail,
  workerCostTreeDetail,
  analysisRevision,
  children,
}: {
  run: Run;
  workerOperationDetail: DetailArtifact | undefined;
  workerCostTreeDetail: DetailArtifact | undefined;
  analysisRevision: string | undefined;
  children: ReactNode;
}) {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const selectedRef = useViz((state) => state.operation);
  const cursorMs = useViz((state) => state.cursorMs);
  const cursorNeedsSeek = useViz((state) => state.cursorNeedsSeek);
  const selectOperationAtCursor = useViz((state) => state.selectOperationAtCursor);
  const clearOperationForSeekResult = useViz((state) => state.clearOperationForSeekResult);
  const enabled = needsWorkerTree(scope);
  const worker = enabled
    ? run.workerList.find((candidate) => candidate.key === workerKey)
    : undefined;
  const [viewport, setViewport] = useState<OperationViewportState | null>(null);
  const debouncedCursorMs = useDebouncedValue(cursorMs, SEEK_DEBOUNCE_MS);
  const indexReady = workerOperationDetail?.status === 'ready';
  const schemaVersion = indexReady ? workerOperationDetail.schemaVersion : undefined;

  useEffect(() => setViewport(null), [workerKey]);

  const bootstrapQuery = useWorkerOperationBootstrapQuery(
    run.id,
    worker?.ref,
    OPERATION_VIEWPORT_SIZE,
    schemaVersion,
    analysisRevision,
    enabled && worker !== undefined && indexReady && !cursorNeedsSeek,
  );
  useEffect(() => {
    if (viewport === null && bootstrapQuery.data !== undefined) {
      setViewport(createOperationViewportState(bootstrapQuery.data, 0));
    }
  }, [bootstrapQuery.data, viewport]);

  const seekQuery = useWorkerOperationSeekQuery(
    run.id,
    worker?.ref,
    debouncedCursorMs,
    OPERATION_VIEWPORT_SIZE,
    schemaVersion,
    analysisRevision,
    enabled &&
      worker !== undefined &&
      cursorNeedsSeek &&
      cursorMs !== null &&
      debouncedCursorMs === cursorMs,
  );
  useEffect(() => {
    const seek = seekQuery.data;
    if (seek === undefined || cursorMs === null || seek.atMs !== cursorMs || !cursorNeedsSeek)
      return;
    setViewport(createOperationViewportState(seek.buffer, seek.suggestedViewport.offset));
    // `hits` only contains half-open interval containment. A cursor in a real
    // compute gap still has a server-selected nearest anchor in the fused
    // buffer, and that exact operation must drive selection and CostTree I/O.
    const anchored = seek.buffer.operations.find(
      (operation) => operation.ordinal === seek.anchor.ordinal,
    );
    if (anchored !== undefined) selectOperationAtCursor(anchored);
    else clearOperationForSeekResult();
  }, [
    clearOperationForSeekResult,
    cursorMs,
    cursorNeedsSeek,
    seekQuery.data,
    selectOperationAtCursor,
  ]);

  const pending = viewport?.pending ?? null;
  const refillQuery = useWorkerOperationsQuery(
    run.id,
    worker?.ref,
    pending?.offset ?? 0,
    pending?.limit ?? OPERATION_VIEWPORT_SIZE,
    schemaVersion,
    analysisRevision,
    pending !== null,
  );
  useEffect(() => {
    if (pending === null || refillQuery.data === undefined) return;
    setViewport((current) =>
      current === null
        ? current
        : resolveOperationBufferRequest(current, pending, refillQuery.data.operations),
    );
  }, [pending, refillQuery.data]);

  const shift = useCallback((direction: OperationBufferDirection) => {
    setViewport((current) =>
      current === null ? current : shiftOperationViewport(current, direction).state,
    );
  }, []);
  const navigate = useCallback((operationDelta: number) => {
    setViewport((current) =>
      current === null ? current : moveOperationViewport(current, operationDelta).state,
    );
  }, []);
  const selected = useMemo(
    () =>
      viewport?.buffer.operations.find(
        (operation) =>
          operation.ref.iterId === selectedRef?.iterId &&
          operation.ref.batchId === selectedRef.batchId &&
          operation.ref.operationId === selectedRef.operationId,
      ) ?? null,
    [selectedRef, viewport],
  );
  const visibleOperations = useMemo(
    () =>
      viewport?.buffer.operations.filter(
        (operation) =>
          operation.ordinal >= viewport.viewportOffset &&
          operation.ordinal < viewport.viewportOffset + OPERATION_VIEWPORT_SIZE,
      ) ?? [],
    [viewport],
  );

  const seekValue: ActiveWorkerOperationSeekState = (() => {
    if (!enabled || worker === undefined || cursorMs === null || !cursorNeedsSeek) {
      return { status: 'idle', atMs: null, hits: [] };
    }
    if (debouncedCursorMs !== cursorMs || seekQuery.isPending) {
      return { status: 'loading', atMs: cursorMs, hits: [] };
    }
    if (seekQuery.isError) {
      return {
        status: 'error',
        atMs: cursorMs,
        hits: [],
        reason: errorReason(seekQuery.error, 'Could not seek worker operations.'),
      };
    }
    return {
      status: 'ready',
      atMs: cursorMs,
      hits: seekQuery.data?.hits ?? [],
    };
  })();

  const operationValue: ActiveWorkerOperationState = (() => {
    if (!enabled) return { status: 'idle', worker: null };
    if (worker === undefined) {
      return { status: 'error', worker: null, reason: 'Selected worker is absent.', retry: null };
    }
    if (!indexReady) {
      const tree = descriptorTreeState(worker, 'worker-operation-index', workerOperationDetail);
      return {
        status: tree.status === 'awaiting-selection' ? 'incompatible' : tree.status,
        worker,
        reason: 'reason' in tree ? tree.reason : 'Loading operation index.',
        retry: null,
      } as ActiveWorkerOperationState;
    }
    if (bootstrapQuery.isError && viewport === null) {
      return {
        status: detailFailureStatus(bootstrapQuery.error),
        worker,
        reason: errorReason(bootstrapQuery.error, 'Could not load worker operations.'),
        retry: () => void bootstrapQuery.refetch(),
      };
    }
    if (viewport === null) return { status: 'loading', worker };
    return {
      status: 'ready',
      worker,
      viewport,
      operations: visibleOperations,
      selected,
      shift,
      navigate,
    };
  })();

  const exactRef =
    worker !== undefined && selectedRef !== null
      ? { worker: worker.ref, ...selectedRef }
      : undefined;
  const treeReady = workerCostTreeDetail?.status === 'ready';
  const treeQuery = useWorkerCostTreeDetailQuery(
    run.id,
    exactRef,
    treeReady ? workerCostTreeDetail.schemaVersion : undefined,
    analysisRevision,
    enabled && worker !== undefined && treeReady && exactRef !== undefined,
  );
  const treeValue: ActiveWorkerTreeState = (() => {
    if (!enabled) return { status: 'idle', worker: null, tree: null, error: null, retry: null };
    if (worker === undefined) {
      return {
        status: 'error',
        worker: null,
        tree: null,
        error: new Error('Selected worker is absent.'),
        retry: null,
      };
    }
    if (!treeReady) return descriptorTreeState(worker, 'worker-cost-tree', workerCostTreeDetail);
    if (exactRef === undefined) {
      return { status: 'awaiting-selection', worker, tree: null, error: null, retry: null };
    }
    if (treeQuery.isError) {
      const status = detailFailureStatus(treeQuery.error);
      return {
        status,
        worker,
        tree: null,
        reason: errorReason(treeQuery.error, 'Could not load exact operation CostTree.'),
        code: errorCode(treeQuery.error),
        retry: status === 'failed' ? () => void treeQuery.refetch() : null,
      };
    }
    if (treeQuery.data === undefined) {
      return { status: 'loading', worker, tree: null, error: null, retry: null };
    }
    return {
      status: 'ready',
      worker,
      operation: {
        iterId: treeQuery.data.iterId,
        batchId: treeQuery.data.batchId,
        operationId: treeQuery.data.operationId,
      },
      tree: treeQuery.data.tree,
      error: null,
      retry: null,
    };
  })();

  return (
    <WorkerOperationSeekContext.Provider value={seekValue}>
      <WorkerOperationContext.Provider value={operationValue}>
        <WorkerTreeContext.Provider value={treeValue}>{children}</WorkerTreeContext.Provider>
      </WorkerOperationContext.Provider>
    </WorkerOperationSeekContext.Provider>
  );
}

export function useActiveWorkerTreeState(): ActiveWorkerTreeState {
  const state = useContext(WorkerTreeContext);
  if (state === null) throw new Error('ActiveWorkerTreeProvider is missing from the ready run.');
  return state;
}

export function useActiveWorkerOperationState(): ActiveWorkerOperationState {
  const state = useContext(WorkerOperationContext);
  if (state === null) throw new Error('ActiveWorkerTreeProvider is missing from the ready run.');
  return state;
}

export function useActiveWorkerOperationSeekState(): ActiveWorkerOperationSeekState {
  const state = useContext(WorkerOperationSeekContext);
  if (state === null) throw new Error('ActiveWorkerTreeProvider is missing from the ready run.');
  return state;
}
