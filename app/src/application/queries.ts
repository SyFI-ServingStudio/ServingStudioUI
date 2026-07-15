import { useQueries, useQuery } from '@tanstack/react-query';

import type { RunDescriptor } from '../domain/artifacts';
import { SUBJECT_NAMES, type SubjectName, type SubjectResult } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import { loadActiveRunCore, type SubjectResults } from './loadActiveRun';
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

interface SubjectQuerySnapshot {
  data: SubjectResult | undefined;
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

function resolveSubjectResult(
  descriptor: RunDescriptor | undefined,
  subject: SubjectName,
  query: SubjectQuerySnapshot,
): SubjectResult {
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
  if (artifact.status !== 'ready') return { subject, ...artifact } as SubjectResult;

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

/** Every analyzer subject owns an immutable revision/schema-scoped query. The
 * returned record is total even while individual artifacts load or fail. */
export function useActiveRunSubjectResults(descriptor: RunDescriptor | undefined): SubjectResults {
  const repository = useAnalyzerRepository();
  const queries = useQueries({
    queries: SUBJECT_NAMES.map((subject) => {
      const artifact = descriptor?.subjects[subject];
      const analysisRevision = descriptor?.analysis?.revision;
      const runId = descriptor?.runId;
      const canLoad =
        runId !== undefined && artifact?.status === 'ready' && analysisRevision !== undefined;
      return {
        queryKey: canLoad
          ? analyzerQueryKeys.subject(runId, subject, artifact.schemaVersion, analysisRevision)
          : [
              ...analyzerQueryKeys.runs(),
              descriptor?.runId ?? 'no-run',
              'subject',
              subject,
              'descriptor-status',
            ],
        queryFn: async (): Promise<SubjectResult> => {
          if (!runId || artifact?.status !== 'ready' || !analysisRevision) {
            throw new Error(`Subject query ${subject} is not loadable from this descriptor.`);
          }
          return repository.getSubject(runId, subject);
        },
        enabled: canLoad,
        staleTime: Infinity,
      };
    }),
  });

  // The subject name is used both as the record key and the query closure
  // argument; this construction boundary preserves the mapped-name invariant.
  return Object.fromEntries(
    SUBJECT_NAMES.map((subject, index) => {
      const query = queries[index];
      return [
        subject,
        resolveSubjectResult(descriptor, subject, {
          data: query.data,
          error: query.error,
          isError: query.isError,
        }),
      ];
    }),
  ) as SubjectResults;
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
