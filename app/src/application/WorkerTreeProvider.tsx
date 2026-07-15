import { createContext, useContext, type ReactNode } from 'react';

import type { Run, WorkerRow } from '../domain/run';
import type { CostNode } from '../data/tree';
import { useViz, type Scope } from '../store';
import { useWorkerCostTreeQuery } from './queries';

export type ActiveWorkerTreeState =
  | { status: 'idle'; worker: null; tree: null; error: null; retry: null }
  | { status: 'loading'; worker: WorkerRow; tree: null; error: null; retry: null }
  | { status: 'ready'; worker: WorkerRow; tree: CostNode; error: null; retry: null }
  | {
      status: 'error';
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

/** Owns the selected worker's one detail query. It deliberately sits below the
 * run provider so a tree failure cannot replace the bounded cluster/pool view. */
export function ActiveWorkerTreeProvider({
  run,
  schemaVersion,
  children,
}: {
  run: Run;
  schemaVersion: number | undefined;
  children: ReactNode;
}) {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const enabled = needsWorkerTree(scope);
  const worker = enabled
    ? run.workerList.find((candidate) => candidate.key === workerKey)
    : undefined;
  const query = useWorkerCostTreeQuery(
    run.id,
    worker?.ref,
    schemaVersion,
    enabled && worker !== undefined,
  );

  const value: ActiveWorkerTreeState = (() => {
    if (!enabled) return { status: 'idle', worker: null, tree: null, error: null, retry: null };
    if (worker === undefined) {
      const selected = workerKey ?? '<none>';
      return {
        status: 'error',
        worker: null,
        tree: null,
        error: new Error(`Selected worker ${selected} is not present in run ${run.id}.`),
        retry: null,
      };
    }
    if (schemaVersion === undefined) {
      return {
        status: 'error',
        worker,
        tree: null,
        error: new Error(`Run ${run.id} has no versioned worker cost-tree artifact source.`),
        retry: null,
      };
    }
    if (query.isError) {
      return {
        status: 'error',
        worker,
        tree: null,
        error: asError(query.error, `Could not load cost tree for ${worker.key}.`),
        retry: () => void query.refetch(),
      };
    }
    if (query.data !== undefined) {
      return { status: 'ready', worker, tree: query.data, error: null, retry: null };
    }
    return { status: 'loading', worker, tree: null, error: null, retry: null };
  })();

  return <WorkerTreeContext.Provider value={value}>{children}</WorkerTreeContext.Provider>;
}

export function useActiveWorkerTreeState(): ActiveWorkerTreeState {
  const state = useContext(WorkerTreeContext);
  if (state === null) throw new Error('ActiveWorkerTreeProvider is missing from the ready run.');
  return state;
}

export function useActiveWorkerTree(): CostNode {
  const state = useActiveWorkerTreeState();
  if (state.status !== 'ready') {
    throw new Error(`Active worker tree is not ready (${state.status}).`);
  }
  return state.tree;
}
