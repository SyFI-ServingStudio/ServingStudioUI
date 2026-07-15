import { useQuery } from '@tanstack/react-query';

import type { TraceResource } from '../../domain/artifacts';
import { useActiveRun, useActiveRunDescriptor } from '../../application/ActiveRunProvider';
import { useAnalyzerRepository } from '../../application/RepositoryProvider';

export const traceResourceQueryKey = (
  runId: string,
  traceName: string,
  analysisRevision: string | undefined,
  descriptorTrace: TraceResource | undefined,
) =>
  [
    'analyzer',
    'runs',
    runId,
    'trace',
    traceName,
    `analysis-${analysisRevision ?? 'unrevisioned'}`,
    JSON.stringify(descriptorTrace ?? null),
  ] as const;

/** Resolve the descriptor-linked trace address only when the user opens it.
 * Trace bytes never enter Query state; the embedding bridge fetches them into a
 * short-lived ArrayBuffer after the address has passed repository validation. */
export function useActiveTraceResource(traceName: string, enabled: boolean) {
  const repository = useAnalyzerRepository();
  const run = useActiveRun();
  const descriptor = useActiveRunDescriptor();
  const descriptorTrace = descriptor.traces[traceName];
  const canLoad = enabled && descriptorTrace?.status === 'ready';
  const query = useQuery({
    queryKey: traceResourceQueryKey(
      run.id,
      traceName,
      descriptor.analysis?.revision,
      descriptorTrace,
    ),
    queryFn: () => repository.getTrace(run.id, traceName),
    enabled: canLoad,
    staleTime: Infinity,
  });

  return { run, descriptorTrace, query };
}
