import { createContext, useContext, useEffect, type ReactNode } from 'react';

import type { RunDescriptor } from '../domain/artifacts';
import type { Run } from '../domain/run';
import { useViz } from '../store';
import { assembleActiveRunData, type ActiveRunData } from './loadActiveRun';
import {
  useActiveRunCoreQuery,
  useActiveRunSubjectResults,
  useRunDescriptorQuery,
  useRunListQuery,
} from './queries';

export type ActiveRunState =
  | { status: 'selecting' | 'loading' | 'empty'; data: null; run: null; error: null }
  | { status: 'error'; data: null; run: null; error: Error }
  | { status: 'ready'; data: ActiveRunData; run: Run; error: null };

const ActiveRunContext = createContext<ActiveRunState | null>(null);

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

type DescriptorReadiness =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; descriptor: RunDescriptor };

/** Simulation completion is the only lifecycle barrier for the bounded core.
 * Analysis can still be pending or failed while summary/topology remain useful;
 * its subject states stay local to their cards. */
function descriptorReadiness(descriptor: RunDescriptor): DescriptorReadiness {
  const simulation = descriptor.lifecycle.simulation;
  if (simulation === 'failed') {
    return {
      status: 'error',
      error: new Error(`Simulation stage failed for ${descriptor.runId}.`),
    };
  }
  if (simulation !== 'complete') return { status: 'loading' };

  return { status: 'ready', descriptor };
}

/** Owns catalog bootstrap and active-run data outside Zustand. Zustand keeps
 * only the requested folder id and local drill selection; React Query owns all
 * repository results, caching and errors. */
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
  const readiness = descriptor.data === undefined ? null : descriptorReadiness(descriptor.data);
  const readyDescriptor = readiness?.status === 'ready' ? readiness.descriptor : undefined;
  const core = useActiveRunCoreQuery(readyDescriptor);
  const subjects = useActiveRunSubjectResults(readyDescriptor);
  const activeData =
    core.data === undefined ? undefined : assembleActiveRunData(core.data, subjects);

  let state: ActiveRunState;
  if (catalog.isError && catalog.data === undefined) {
    state = {
      status: 'error',
      data: null,
      run: null,
      error: asError(catalog.error, 'Could not load the simulation-folder catalog.'),
    };
  } else if (catalog.isPending) {
    state = { status: 'selecting', data: null, run: null, error: null };
  } else if (resolvedRunId === null) {
    state = { status: 'empty', data: null, run: null, error: null };
  } else if (descriptor.isError) {
    state = {
      status: 'error',
      data: null,
      run: null,
      error: asError(descriptor.error, `Could not load descriptor for ${resolvedRunId}.`),
    };
  } else if (readiness?.status === 'error') {
    state = { status: 'error', data: null, run: null, error: readiness.error };
  } else if (descriptor.data === undefined || readiness?.status === 'loading' || core.isPending) {
    state = { status: 'loading', data: null, run: null, error: null };
  } else if (core.isError) {
    state = {
      status: 'error',
      data: null,
      run: null,
      error: asError(core.error, `Could not assemble core data for ${resolvedRunId}.`),
    };
  } else if (activeData === undefined) {
    state = { status: 'loading', data: null, run: null, error: null };
  } else {
    state = { status: 'ready', data: activeData, run: activeData.run, error: null };
  }

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

export function useActiveRunData(): ActiveRunData {
  const state = useActiveRunState();
  if (state.status !== 'ready') throw new Error(`Active run data is not ready (${state.status}).`);
  return state.data;
}
