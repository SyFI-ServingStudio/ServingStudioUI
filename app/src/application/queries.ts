import { useQuery } from '@tanstack/react-query';

import type { RunDescriptor } from '../domain/artifacts';
import type { SubjectName, SubjectResult } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import { loadActiveRunCore } from './loadActiveRun';
import {
  CATALOG_POLL_INTERVAL_MS,
  descriptorPollInterval,
  LIFECYCLE_REFETCH_ON_WINDOW_FOCUS,
} from './lifecyclePolling';
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
  workerCostTreeDetail: (
    runId: string,
    worker: WorkerRef,
    schemaVersion: number,
    analysisRevision: string,
  ) =>
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
  core: (runId: string, descriptorFingerprint: string) =>
    [...analyzerQueryKeys.runs(), runId, 'active-core', descriptorFingerprint] as const,
};

function coreDescriptorFingerprint(descriptor: RunDescriptor): string {
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
    perfettoTrace: descriptor.traces.perfetto,
    analysis: descriptor.analysis,
    provenance: descriptor.provenance,
  });
}

export function useRunListQuery() {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.runs(),
    queryFn: () => repository.listRuns(),
    refetchInterval: CATALOG_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: LIFECYCLE_REFETCH_ON_WINDOW_FOCUS,
  });
}

export function useRunDescriptorQuery(runId: string) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.descriptor(runId),
    queryFn: () => repository.getRunDescriptor(runId),
    enabled: runId.length > 0,
    refetchInterval: (query) => descriptorPollInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: LIFECYCLE_REFETCH_ON_WINDOW_FOCUS,
  });
}

export function useActiveRunCoreQuery(descriptor: RunDescriptor | undefined) {
  const repository = useAnalyzerRepository();
  const runId = descriptor?.runId ?? '';
  const fingerprint = descriptor ? coreDescriptorFingerprint(descriptor) : 'pending-descriptor';
  return useQuery({
    queryKey: analyzerQueryKeys.core(runId, fingerprint),
    queryFn: () => {
      if (!descriptor)
        throw new Error('Cannot assemble an active-run core without its descriptor.');
      return loadActiveRunCore(repository, descriptor);
    },
    enabled: descriptor !== undefined,
  });
}

interface SubjectQuerySnapshot<Name extends SubjectName> {
  data: SubjectResult<Name> | undefined;
  error: unknown;
  isError: boolean;
}

function stableErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'artifact_load_failed';
  }
  return typeof error.code === 'string' && error.code.length > 0
    ? error.code
    : 'artifact_load_failed';
}

function errorReason(error: unknown, subject: SubjectName): string {
  return error instanceof Error ? error.message : `Could not load analyzer subject ${subject}.`;
}

function resolveSubjectResult<Name extends SubjectName>(
  descriptor: RunDescriptor | undefined,
  subject: Name,
  query: SubjectQuerySnapshot<Name>,
): SubjectResult<Name> {
  if (descriptor === undefined) {
    return { subject, status: 'pending', reason: 'Waiting for run descriptor.' };
  }

  const artifact = descriptor.subjects[subject];
  if (artifact === undefined) {
    return {
      subject,
      status: 'not_generated',
      reason: 'Run descriptor does not declare this analyzer subject.',
    };
  }
  if (artifact.status !== 'ready') return { subject, ...artifact };

  if (descriptor.analysis?.revision === undefined) {
    return {
      subject,
      status: 'incompatible',
      receivedSchemaVersion: artifact.schemaVersion,
      reason: 'A ready subject requires descriptor.analysis.revision for cache identity.',
    };
  }
  if (query.isError) {
    return {
      subject,
      status: 'failed',
      code: stableErrorCode(query.error),
      reason: errorReason(query.error, subject),
    };
  }
  if (query.data === undefined) {
    return { subject, status: 'pending', reason: 'Loading analyzer subject artifact.' };
  }
  if (query.data.subject !== subject) {
    return {
      subject,
      status: 'incompatible',
      reason: `Repository returned subject ${query.data.subject} for ${subject}.`,
    };
  }
  if (query.data.status === 'ready' && query.data.schemaVersion !== artifact.schemaVersion) {
    return {
      subject,
      status: 'incompatible',
      receivedSchemaVersion: query.data.schemaVersion,
      reason: `Descriptor expects schema v${artifact.schemaVersion}, received v${query.data.schemaVersion}.`,
    };
  }
  return query.data;
}

/** Subscribe to exactly one revision/schema-scoped subject. Descriptor states
 * are returned without I/O; a ready artifact owns one independent Query cache
 * entry, so unrelated subject completion cannot fan out through run context. */
export function useDescriptorSubjectQuery<Name extends SubjectName>(
  descriptor: RunDescriptor | undefined,
  subject: Name,
): SubjectResult<Name> {
  const repository = useAnalyzerRepository();
  const artifact = descriptor?.subjects[subject];
  const analysisRevision = descriptor?.analysis?.revision;
  const request =
    descriptor !== undefined && artifact?.status === 'ready' && analysisRevision !== undefined
      ? {
          runId: descriptor.runId,
          schemaVersion: artifact.schemaVersion,
          analysisRevision,
        }
      : null;
  const query = useQuery({
    queryKey:
      request === null
        ? [
            ...analyzerQueryKeys.runs(),
            descriptor?.runId ?? 'no-run',
            'subject',
            subject,
            'descriptor-status',
            JSON.stringify(artifact ?? null),
          ]
        : analyzerQueryKeys.subject(
            request.runId,
            subject,
            request.schemaVersion,
            request.analysisRevision,
          ),
    queryFn: (): Promise<SubjectResult<Name>> => {
      if (request === null) {
        throw new Error(`Subject query ${subject} is not loadable from this descriptor.`);
      }
      return repository.getSubject(request.runId, subject);
    },
    enabled: request !== null,
    staleTime: Infinity,
  });

  return resolveSubjectResult(descriptor, subject, {
    data: query.data,
    error: query.error,
    isError: query.isError,
  });
}

/** High-cardinality hierarchical worker detail stays outside active-run assembly. The
 * analysis revision separates regenerated content even when href and schema
 * version remain unchanged. */
export function useWorkerCostTreeDetailQuery(
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
            : analyzerQueryKeys.workerCostTreeDetail(
                runId,
                worker,
                schemaVersion,
                analysisRevision,
              ),
    queryFn: () => {
      if (worker === undefined) {
        throw new Error('Cannot load a worker CostTree detail without a WorkerRef.');
      }
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
