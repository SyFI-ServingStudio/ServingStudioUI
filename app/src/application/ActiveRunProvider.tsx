import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import type { RunDescriptor } from '../domain/artifacts';
import type { Run } from '../domain/run';
import type {
  ModelConfigResource,
  OverviewResourceResult,
  WorkloadOverviewResource,
} from '../domain/overviewResources';
import type { SubjectName, SubjectResult } from '../domain/subject';
import { useViz } from '../store';
import {
  useActiveRunCoreQuery,
  useDescriptorSubjectQuery,
  useDescriptorModelQuery,
  useDescriptorWorkloadQuery,
  useRunDescriptorQuery,
  useRunListQuery,
} from './queries';

export type ActiveRunState =
  | {
      status: 'selecting' | 'loading' | 'empty';
      descriptor: null;
      run: null;
      error: null;
    }
  | { status: 'error'; descriptor: null; run: null; error: Error }
  | { status: 'ready'; descriptor: RunDescriptor; run: Run; error: null };

const ActiveRunContext = createContext<ActiveRunState | null>(null);

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/** Owns catalog bootstrap and active-run data outside Zustand. Zustand keeps
 * only the requested folder id and local drill selection; React Query owns all
 * repository results, caching and errors. The context stops at bounded core
 * facts; optional subjects are subscribed independently by name. */
export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const requestedRunId = useViz((state) => state.runId);
  const setRun = useViz((state) => state.setRun);
  const catalog = useRunListQuery();
  const catalogRuns = catalog.data ?? [];
  const requestedExists =
    requestedRunId !== null && catalogRuns.some((run) => run.runId === requestedRunId);
  const resolvedRunId = requestedExists ? requestedRunId : (catalogRuns[0]?.runId ?? null);

  useEffect(() => {
    if (resolvedRunId !== null && resolvedRunId !== requestedRunId) setRun(resolvedRunId);
  }, [requestedRunId, resolvedRunId, setRun]);

  const descriptor = useRunDescriptorQuery(resolvedRunId ?? '');
  // Simulation completion is the only lifecycle barrier for summary/topology.
  // Analysis may still be pending or failed while optional subject cards work.
  const readyDescriptor =
    descriptor.data?.lifecycle.simulation === 'complete' ? descriptor.data : undefined;
  const core = useActiveRunCoreQuery(readyDescriptor);
  const state = useMemo<ActiveRunState>(() => {
    if (catalog.isError && catalog.data === undefined) {
      return {
        status: 'error',
        descriptor: null,
        run: null,
        error: asError(catalog.error, 'Could not load the simulation-folder catalog.'),
      };
    }
    if (catalog.isPending) {
      return { status: 'selecting', descriptor: null, run: null, error: null };
    }
    if (resolvedRunId === null) {
      return { status: 'empty', descriptor: null, run: null, error: null };
    }
    if (descriptor.isError) {
      return {
        status: 'error',
        descriptor: null,
        run: null,
        error: asError(descriptor.error, `Could not load descriptor for ${resolvedRunId}.`),
      };
    }
    if (descriptor.data?.lifecycle.simulation === 'failed') {
      return {
        status: 'error',
        descriptor: null,
        run: null,
        error: new Error(`Simulation stage failed for ${descriptor.data.runId}.`),
      };
    }
    if (descriptor.data === undefined || readyDescriptor === undefined || core.isPending) {
      return { status: 'loading', descriptor: null, run: null, error: null };
    }
    if (core.isError) {
      return {
        status: 'error',
        descriptor: null,
        run: null,
        error: asError(core.error, `Could not assemble core data for ${resolvedRunId}.`),
      };
    }
    if (core.data === undefined) {
      return { status: 'loading', descriptor: null, run: null, error: null };
    }
    return {
      status: 'ready',
      descriptor: core.data.descriptor,
      run: core.data.run,
      error: null,
    };
  }, [
    catalog.data,
    catalog.error,
    catalog.isError,
    catalog.isPending,
    core.data,
    core.error,
    core.isError,
    core.isPending,
    descriptor.data,
    descriptor.error,
    descriptor.isError,
    readyDescriptor,
    resolvedRunId,
  ]);

  return <ActiveRunContext.Provider value={state}>{children}</ActiveRunContext.Provider>;
}

export function useActiveRunState(): ActiveRunState {
  const state = useContext(ActiveRunContext);
  if (!state) throw new Error('ActiveRunProvider is missing from the application root.');
  return state;
}

export function useActiveRun(): Run {
  const state = useActiveRunState();
  if (state.status !== 'ready') throw new Error(`Active run is not ready (${state.status}).`);
  return state.run;
}

export function useActiveRunDescriptor(): RunDescriptor {
  const state = useActiveRunState();
  if (state.status !== 'ready') {
    throw new Error(`Active run descriptor is not ready (${state.status}).`);
  }
  return state.descriptor;
}

/** Components subscribe only to the subject they render. The hook is total:
 * before core readiness it returns an explicit pending result, and once ready
 * it preserves descriptor/non-ready/error/incompatible states independently. */
export function useActiveRunSubject<Name extends SubjectName>(subject: Name): SubjectResult<Name> {
  const state = useActiveRunState();
  const descriptor = state.status === 'ready' ? state.descriptor : undefined;
  return useDescriptorSubjectQuery(descriptor, subject);
}

export function useActiveRunModel(): OverviewResourceResult<ModelConfigResource> {
  const state = useActiveRunState();
  return useDescriptorModelQuery(state.status === 'ready' ? state.descriptor : undefined);
}

export function useActiveRunWorkload(): OverviewResourceResult<WorkloadOverviewResource> {
  const state = useActiveRunState();
  return useDescriptorWorkloadQuery(state.status === 'ready' ? state.descriptor : undefined);
}
