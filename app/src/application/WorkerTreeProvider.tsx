import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { DetailArtifact } from '../domain/artifacts';
import { KERNEL_TIME_EPSILON_MS } from '../domain/kernelTimeShare';
import type { Run, WorkerRow } from '../domain/run';
import type { SubjectResult } from '../domain/subject';
import { makeWorkerKey } from '../domain/worker';
import { projectAggregateKernelVisualTree } from './projectAggregateKernelVisualTree';
import type { CostTree } from '../domain/cost-tree';
import { useViz, type Scope } from '../store';
import { useWorkerCostTreeDetailQuery } from './queries';

export type WorkerTreeEvidence = 'hierarchical-detail' | 'aggregate-projection';

export type WorkerTreeNonReadyStatus =
  'empty' | 'unavailable' | 'not_generated' | 'failed' | 'incompatible';

interface WorkerTreeNonReadyState {
  status: WorkerTreeNonReadyStatus;
  evidence: WorkerTreeEvidence;
  worker: WorkerRow;
  tree: null;
  reason: string;
  code: string | null;
  retry: (() => void) | null;
}

export type ActiveWorkerTreeState =
  | {
      status: 'idle';
      evidence: null;
      worker: null;
      tree: null;
      error: null;
      retry: null;
    }
  | {
      status: 'loading';
      evidence: WorkerTreeEvidence;
      worker: WorkerRow;
      tree: null;
      error: null;
      retry: null;
    }
  | {
      status: 'ready';
      evidence: WorkerTreeEvidence;
      worker: WorkerRow;
      tree: CostTree;
      error: null;
      retry: null;
    }
  | {
      status: 'error';
      evidence: WorkerTreeEvidence | null;
      worker: WorkerRow | null;
      tree: null;
      error: Error;
      retry: (() => void) | null;
    }
  | WorkerTreeNonReadyState;

const WorkerTreeContext = createContext<ActiveWorkerTreeState | null>(null);

const needsWorkerTree = (scope: Scope): boolean =>
  scope === 'worker' || scope === 'kernel' || scope === 'parallel';

function errorReason(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' && error.code.length > 0 ? error.code : null;
}

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

function artifactReason(subject: SubjectResult<'kernelTimeShare'>, fallback: string): string {
  if ('reason' in subject && subject.reason) return subject.reason;
  return fallback;
}

function detailContext(detail: DetailArtifact | undefined): string {
  const status = detail?.status ?? 'not_generated';
  const reason = detail && 'reason' in detail && detail.reason ? `: ${detail.reason}` : '';
  return `Hierarchical worker detail is ${status}${reason}.`;
}

/**
 * Owns the selected worker's evidence boundary. A ready descriptor detail uses
 * the repository's versioned high-cardinality query. Until that protocol is
 * generated, the already-loaded kernel-time-share subject may be projected
 * locally, but the state keeps that aggregate evidence explicitly labelled.
 */
export function ActiveWorkerTreeProvider({
  run,
  workerCostTreeDetail,
  aggregateKernelTimeShare,
  analysisRevision,
  children,
}: {
  run: Run;
  workerCostTreeDetail: DetailArtifact | undefined;
  aggregateKernelTimeShare: SubjectResult<'kernelTimeShare'>;
  analysisRevision: string | undefined;
  children: ReactNode;
}) {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const enabled = needsWorkerTree(scope);
  const worker = enabled
    ? run.workerList.find((candidate) => candidate.key === workerKey)
    : undefined;
  const detailReady = workerCostTreeDetail?.status === 'ready';
  const detailQuery = useWorkerCostTreeDetailQuery(
    run.id,
    worker?.ref,
    detailReady ? workerCostTreeDetail.schemaVersion : undefined,
    analysisRevision,
    enabled && worker !== undefined && detailReady,
  );

  const aggregateComposition = useMemo(() => {
    if (!enabled || worker === undefined || detailReady) return null;
    if (aggregateKernelTimeShare.status !== 'ready') return null;
    return aggregateKernelTimeShare.payload.workers.find(
      (candidate) => candidate.key === makeWorkerKey(worker.ref),
    );
  }, [aggregateKernelTimeShare, detailReady, enabled, worker]);
  const aggregateProjection = useMemo(
    () =>
      aggregateComposition === null || aggregateComposition === undefined
        ? null
        : projectAggregateKernelVisualTree(aggregateComposition),
    [aggregateComposition],
  );

  const value: ActiveWorkerTreeState = (() => {
    if (!enabled) {
      return {
        status: 'idle',
        evidence: null,
        worker: null,
        tree: null,
        error: null,
        retry: null,
      };
    }
    if (worker === undefined) {
      const selected = workerKey ?? '<none>';
      return {
        status: 'error',
        evidence: null,
        worker: null,
        tree: null,
        error: new Error(`Selected worker ${selected} is not present in run ${run.id}.`),
        retry: null,
      };
    }

    if (detailReady) {
      if (analysisRevision === undefined) {
        return {
          status: 'incompatible',
          evidence: 'hierarchical-detail',
          worker,
          tree: null,
          reason: `Run ${run.id} has no analysis revision for worker detail cache identity.`,
          code: null,
          retry: null,
        };
      }
      if (detailQuery.isError) {
        const status = detailFailureStatus(detailQuery.error);
        return {
          status,
          evidence: 'hierarchical-detail',
          worker,
          tree: null,
          reason: errorReason(
            detailQuery.error,
            `Could not load CostTree detail for ${worker.key}.`,
          ),
          code: errorCode(detailQuery.error),
          retry: status === 'failed' ? () => void detailQuery.refetch() : null,
        };
      }
      if (detailQuery.data !== undefined) {
        return {
          status: 'ready',
          evidence: 'hierarchical-detail',
          worker,
          tree: detailQuery.data,
          error: null,
          retry: null,
        };
      }
      return {
        status: 'loading',
        evidence: 'hierarchical-detail',
        worker,
        tree: null,
        error: null,
        retry: null,
      };
    }

    if (aggregateProjection !== null) {
      return {
        status: 'ready',
        evidence: 'aggregate-projection',
        worker,
        tree: aggregateProjection.tree,
        error: null,
        retry: null,
      };
    }
    if (aggregateKernelTimeShare.status === 'pending') {
      return {
        status: 'loading',
        evidence: 'aggregate-projection',
        worker,
        tree: null,
        error: null,
        retry: null,
      };
    }
    if (aggregateKernelTimeShare.status === 'ready') {
      if (aggregateComposition === null || aggregateComposition === undefined) {
        return {
          status: 'incompatible',
          evidence: 'aggregate-projection',
          worker,
          tree: null,
          reason: `Ready kernel-time-share does not contain composite worker ${worker.key}. ${detailContext(workerCostTreeDetail)}`,
          code: null,
          retry: null,
        };
      }
      if (aggregateComposition.kernelTimeMs <= KERNEL_TIME_EPSILON_MS) {
        return {
          status: 'empty',
          evidence: 'aggregate-projection',
          worker,
          tree: null,
          reason: `Worker ${worker.key} has zero reportable kernel time in this run. ${detailContext(workerCostTreeDetail)}`,
          code: null,
          retry: null,
        };
      }
      return {
        status: 'incompatible',
        evidence: 'aggregate-projection',
        worker,
        tree: null,
        reason: `Worker ${worker.key} has positive kernel time but no projectable segments. ${detailContext(workerCostTreeDetail)}`,
        code: null,
        retry: null,
      };
    }

    return {
      status: aggregateKernelTimeShare.status,
      evidence: 'aggregate-projection',
      worker,
      tree: null,
      reason: `${artifactReason(
        aggregateKernelTimeShare,
        `Aggregate kernel-time-share is ${aggregateKernelTimeShare.status}.`,
      )} ${detailContext(workerCostTreeDetail)}`,
      code:
        aggregateKernelTimeShare.status === 'failed'
          ? aggregateKernelTimeShare.code
          : aggregateKernelTimeShare.status === 'unavailable'
            ? (aggregateKernelTimeShare.code ?? null)
            : null,
      retry: null,
    };
  })();

  return <WorkerTreeContext.Provider value={value}>{children}</WorkerTreeContext.Provider>;
}

export function useActiveWorkerTreeState(): ActiveWorkerTreeState {
  const state = useContext(WorkerTreeContext);
  if (state === null) throw new Error('ActiveWorkerTreeProvider is missing from the ready run.');
  return state;
}

export function useActiveWorkerTree(): CostTree {
  const state = useActiveWorkerTreeState();
  if (state.status !== 'ready') {
    throw new Error(`Active worker tree is not ready (${state.status}).`);
  }
  return state.tree;
}
