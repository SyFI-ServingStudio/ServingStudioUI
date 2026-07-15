import { createContext, useContext, useEffect, type ReactNode } from 'react';

import type { RunDescriptor } from '../domain/artifacts';
import type { Run } from '../domain/run';
import { useViz } from '../store';
import type { ActiveRunData } from './loadActiveRun';
import { useActiveRunDataQuery, useRunDescriptorQuery, useRunListQuery } from './queries';

export type ActiveRunState =
  | { status: 'selecting' | 'loading' | 'empty'; data: null; run: null; error: null }
  | { status: 'error'; data: null; run: null; error: Error }
  | { status: 'ready'; data: ActiveRunData; run: Run; error: null };

const ActiveRunContext = createContext<ActiveRunState | null>(null);
const REQUIRED_SUBJECTS = ['slo', 'throughput', 'utilization', 'kv'] as const;

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

type DescriptorReadiness =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; descriptor: RunDescriptor };

/** A descriptor is the analyzer's completion barrier. Do not turn an expected
 * pending state into a rejected assembly query, and do not fetch artifacts
 * after the analyzer has already declared a required stage or subject failed. */
function descriptorReadiness(descriptor: RunDescriptor): DescriptorReadiness {
  for (const [stage, status] of Object.entries(descriptor.lifecycle)) {
    if (status === 'failed') {
      return { status: 'error', error: new Error(`Analyzer ${stage} stage failed for ${descriptor.runId}.`) };
    }
    if (status !== 'complete') return { status: 'loading' };
  }

  for (const subjectName of REQUIRED_SUBJECTS) {
    const artifact = descriptor.subjects[subjectName];
    if (artifact === undefined) {
      return {
        status: 'error',
        error: new Error(`Run descriptor ${descriptor.runId} is missing required subject ${subjectName}.`),
      };
    }
    if (artifact.status === 'pending') return { status: 'loading' };
    if (artifact.status !== 'ready') {
      const reason = 'reason' in artifact && artifact.reason ? `: ${artifact.reason}` : '';
      return {
        status: 'error',
        error: new Error(`Required analyzer subject ${subjectName} is ${artifact.status}${reason}`),
      };
    }
  }

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
  const requestedExists = requestedRunId !== null
    && catalogRuns.some((run) => run.runId === requestedRunId);
  const resolvedRunId = requestedExists ? requestedRunId : catalogRuns[0]?.runId ?? null;

  useEffect(() => {
    if (resolvedRunId !== null && resolvedRunId !== requestedRunId) setRun(resolvedRunId);
  }, [requestedRunId, resolvedRunId, setRun]);

  const descriptor = useRunDescriptorQuery(resolvedRunId ?? '');
  const readiness = descriptor.data === undefined ? null : descriptorReadiness(descriptor.data);
  const activeData = useActiveRunDataQuery(readiness?.status === 'ready' ? readiness.descriptor : undefined);

  let state: ActiveRunState;
  if (catalog.isError && catalog.data === undefined) {
    state = { status: 'error', data: null, run: null, error: asError(catalog.error, 'Could not load the simulation-folder catalog.') };
  } else if (catalog.isPending) {
    state = { status: 'selecting', data: null, run: null, error: null };
  } else if (resolvedRunId === null) {
    state = { status: 'empty', data: null, run: null, error: null };
  } else if (descriptor.isError) {
    state = { status: 'error', data: null, run: null, error: asError(descriptor.error, `Could not load descriptor for ${resolvedRunId}.`) };
  } else if (readiness?.status === 'error') {
    state = { status: 'error', data: null, run: null, error: readiness.error };
  } else if (descriptor.data === undefined || readiness?.status === 'loading' || activeData.isPending) {
    state = { status: 'loading', data: null, run: null, error: null };
  } else if (activeData.isError) {
    state = { status: 'error', data: null, run: null, error: asError(activeData.error, `Could not assemble ${resolvedRunId}.`) };
  } else if (activeData.data === undefined) {
    state = { status: 'loading', data: null, run: null, error: null };
  } else {
    state = { status: 'ready', data: activeData.data, run: activeData.data.run, error: null };
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
