import { useQuery } from '@tanstack/react-query';

import type { RunDescriptor } from '../domain/artifacts';
import type { SubjectName } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import { loadActiveRunData } from './loadActiveRun';
import { useAnalyzerRepository } from './RepositoryProvider';

export const analyzerQueryKeys = {
  all: ['analyzer'] as const,
  runs: () => [...analyzerQueryKeys.all, 'runs'] as const,
  summary: (runId: string, analysisRevision: string) =>
    [...analyzerQueryKeys.runs(), runId, 'summary', `analysis-${analysisRevision}`] as const,
  topology: (runId: string, analysisRevision: string) =>
    [...analyzerQueryKeys.runs(), runId, 'topology', `analysis-${analysisRevision}`] as const,
  descriptor: (runId: string) => [...analyzerQueryKeys.runs(), runId, 'descriptor'] as const,
  subject: (runId: string, subject: string, schemaVersion: number, analysisRevision: string) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'subject',
      subject,
      `schema-v${schemaVersion}`,
      `analysis-${analysisRevision}`,
    ] as const,
  workerTree: (runId: string, worker: WorkerRef, schemaVersion: number, analysisRevision: string) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      worker.poolTag,
      worker.workerId,
      'cost-tree',
      `schema-v${schemaVersion}`,
      `analysis-${analysisRevision}`,
    ] as const,
  active: (runId: string, descriptorFingerprint: string) =>
    [...analyzerQueryKeys.runs(), runId, 'active-view', descriptorFingerprint] as const,
};

function descriptorFingerprint(descriptor: RunDescriptor): string {
  return JSON.stringify({
    protocolVersion: descriptor.protocolVersion,
    runId: descriptor.runId,
    displayName: descriptor.displayName,
    modelName: descriptor.modelName,
    deployment: descriptor.deployment,
    lifecycle: descriptor.lifecycle,
    summary: descriptor.summary,
    topology: descriptor.topology,
    workers: descriptor.workers,
    subjects: descriptor.subjects,
    details: descriptor.details,
    traces: descriptor.traces,
    analysis: descriptor.analysis,
    provenance: descriptor.provenance,
  });
}

export function useRunListQuery() {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.runs(),
    queryFn: () => repository.listRuns(),
  });
}

export function useRunDescriptorQuery(runId: string) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.descriptor(runId),
    queryFn: () => repository.getRunDescriptor(runId),
    enabled: runId.length > 0,
  });
}

export function useSubjectQuery<Name extends SubjectName>(
  runId: string,
  subject: Name,
  schemaVersion: number,
  analysisRevision: string,
) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.subject(runId, subject, schemaVersion, analysisRevision),
    queryFn: () => repository.getSubject(runId, subject),
    enabled: runId.length > 0,
  });
}

export function useActiveRunDataQuery(descriptor: RunDescriptor | undefined) {
  const repository = useAnalyzerRepository();
  const runId = descriptor?.runId ?? '';
  const fingerprint = descriptor ? descriptorFingerprint(descriptor) : 'pending-descriptor';
  return useQuery({
    queryKey: analyzerQueryKeys.active(runId, fingerprint),
    queryFn: () => {
      if (!descriptor) throw new Error('Cannot assemble an active run without its descriptor.');
      return loadActiveRunData(repository, descriptor);
    },
    enabled: descriptor !== undefined,
  });
}

/** High-cardinality worker detail stays outside the active-run assembly. The
 * analysis revision separates regenerated content even when href and schema
 * version remain unchanged. */
export function useWorkerCostTreeQuery(
  runId: string,
  worker: WorkerRef | undefined,
  schemaVersion: number | undefined,
  analysisRevision: string | undefined,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey:
      worker === undefined
        ? [...analyzerQueryKeys.runs(), runId, 'worker', 'no-selection', 'cost-tree']
        : schemaVersion === undefined
          ? [
              ...analyzerQueryKeys.runs(),
              runId,
              'worker',
              worker.poolTag,
              worker.workerId,
              'cost-tree',
              'unversioned',
            ]
          : analysisRevision === undefined
            ? [
                ...analyzerQueryKeys.runs(),
                runId,
                'worker',
                worker.poolTag,
                worker.workerId,
                'cost-tree',
                `schema-v${schemaVersion}`,
                'unrevisioned',
              ]
            : analyzerQueryKeys.workerTree(runId, worker, schemaVersion, analysisRevision),
    queryFn: () => {
      if (worker === undefined) throw new Error('Cannot load a worker tree without a WorkerRef.');
      return repository.getWorkerCostTree(runId, worker);
    },
    enabled:
      enabled &&
      runId.length > 0 &&
      worker !== undefined &&
      schemaVersion !== undefined &&
      analysisRevision !== undefined,
    staleTime: Infinity,
  });
}
