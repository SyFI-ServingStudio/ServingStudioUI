import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { DetailArtifact } from '../domain/artifacts';
import type { Run, WorkerRow } from '../domain/run';
import type { SubjectResult } from '../domain/subject';
import { makeWorkerKey } from '../domain/worker';
import { projectAggregateKernelVisualTree } from '../data/aggregateKernelComposition';
import type { CostTree } from '../data/tree';
import { useViz, type Scope } from '../store';
import { useWorkerCostTreeDetailQuery } from './queries';

export type WorkerTreeEvidence = 'hierarchical-detail' | 'aggregate-projection';

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
    };

const WorkerTreeContext = createContext<ActiveWorkerTreeState | null>(null);

const needsWorkerTree = (scope: Scope): boolean =>
  scope === 'worker' || scope === 'kernel' || scope === 'parallel';

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function aggregateProjectionReason(
  subject: SubjectResult<'kernelTimeShare'>,
  workerKey: string,
): string {
  if (subject.status === 'ready') {
    return `kernel-time-share has no reportable composition for ${workerKey}`;
  }
  if ('reason' in subject && subject.reason) return subject.reason;
  return `kernel-time-share is ${subject.status}`;
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

  const aggregateProjection = useMemo(() => {
    if (!enabled || worker === undefined || detailReady) return null;
    if (aggregateKernelTimeShare.status !== 'ready') return null;
    const composition = aggregateKernelTimeShare.payload.workers.find(
      (candidate) => candidate.key === makeWorkerKey(worker.ref),
    );
    return composition === undefined ? null : projectAggregateKernelVisualTree(composition);
  }, [aggregateKernelTimeShare, detailReady, enabled, worker]);

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
          status: 'error',
          evidence: 'hierarchical-detail',
          worker,
          tree: null,
          error: new Error(`Run ${run.id} has no analysis revision for worker detail caching.`),
          retry: null,
        };
      }
      if (detailQuery.isError) {
        return {
          status: 'error',
          evidence: 'hierarchical-detail',
          worker,
          tree: null,
          error: asError(detailQuery.error, `Could not load cost tree detail for ${worker.key}.`),
          retry: () => void detailQuery.refetch(),
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

    const detailStatus = workerCostTreeDetail?.status ?? 'not_generated';
    return {
      status: 'error',
      evidence: 'aggregate-projection',
      worker,
      tree: null,
      error: new Error(
        `Run ${run.id} worker-cost-tree detail is ${detailStatus}; aggregate projection is unavailable: ${aggregateProjectionReason(aggregateKernelTimeShare, worker.key)}.`,
      ),
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
