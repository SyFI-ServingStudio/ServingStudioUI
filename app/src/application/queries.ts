import { queryOptions, useQueries, useQuery } from '@tanstack/react-query';

import { AnalyzerV1OverviewResourceError } from '../contracts/analyzer/v1/overviewResources';
import type { AlignmentSubjectName } from '../domain/alignment';
import type { RunDescriptor } from '../domain/artifacts';
import type {
  ModelConfigResource,
  OverviewResourceResult,
  WorkloadOverviewResource,
} from '../domain/overviewResources';
import type { OptimalityMode } from '../domain/optimality';
import type { SubjectName, SubjectResult } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import type { WorkerCostTreeRef } from '../domain/workerOperation';
import type { WorkerOperationBuffer } from '../domain/workerOperation';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { loadActiveRunCore } from './loadActiveRun';
import {
  CATALOG_POLL_INTERVAL_MS,
  descriptorPollInterval,
  LIFECYCLE_REFETCH_ON_WINDOW_FOCUS,
} from './lifecyclePolling';
import { useAnalyzerRepository } from './RepositoryProvider';
import { currentTimelineInteractionId, timelineProfileEvent } from './timelineProfiling';

export const analyzerQueryKeys = {
  all: ['analyzer'] as const,
  runs: () => [...analyzerQueryKeys.all, 'runs'] as const,
  sweeps: () => [...analyzerQueryKeys.all, 'sweeps'] as const,
  sweep: (sweepId: string) => [...analyzerQueryKeys.sweeps(), sweepId, 'payload'] as const,
  summary: (runId: string, analysisRevision: string) =>
    [...analyzerQueryKeys.runs(), runId, 'summary', `analysis-${analysisRevision}`] as const,
  topology: (runId: string, analysisRevision: string) =>
    [...analyzerQueryKeys.runs(), runId, 'topology', `analysis-${analysisRevision}`] as const,
  overviewResource: (
    runId: string,
    name: 'model' | 'workload',
    href: string,
    schemaVersion: number,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'overview-resource',
      name,
      href,
      `schema-v${schemaVersion}`,
    ] as const,
  descriptor: (runId: string) => [...analyzerQueryKeys.runs(), runId, 'descriptor'] as const,
  subject: (
    runId: string,
    subject: string,
    schemaVersion: number,
    analysisRevision: string,
    variant = 'primary',
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'subject',
      subject,
      `variant-${variant}`,
      `schema-v${schemaVersion}`,
      `analysis-${analysisRevision}`,
    ] as const,
  workerCostTreeDetail: (
    runId: string,
    ref: WorkerCostTreeRef,
    schemaVersion: number,
    analysisRevision: string,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      ref.worker.poolTag,
      ref.worker.workerId,
      'operation-ref',
      ref.iterId,
      ref.batchId,
      'operation',
      ref.operationId,
      'cost-tree',
      `schema-v${schemaVersion}`,
      `analysis-${analysisRevision}`,
    ] as const,
  kernelThroughputAnalysis: (
    runId: string,
    ref: WorkerCostTreeRef,
    leafId: number,
    analysisRevision: string,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      ref.worker.poolTag,
      ref.worker.workerId,
      'operation-ref',
      ref.iterId,
      ref.batchId,
      'operation',
      ref.operationId,
      'leaf',
      leafId,
      'kernel-throughput-analysis',
      `analysis-${analysisRevision}`,
    ] as const,
  iterationOptimalityKernelLadder: (
    runId: string,
    worker: WorkerRef,
    iterId: string,
    mode: OptimalityMode,
    analysisRevision: string,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      worker.poolTag,
      worker.workerId,
      'iteration',
      iterId,
      'optimality-kernel-ladder',
      `mode-${mode}`,
      `analysis-${analysisRevision}`,
    ] as const,
  iterationOptimalityWaterfall: (
    runId: string,
    worker: WorkerRef,
    iterId: string,
    mode: OptimalityMode,
    analysisRevision: string,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      worker.poolTag,
      worker.workerId,
      'iteration',
      iterId,
      'optimality-waterfall',
      `mode-${mode}`,
      `analysis-${analysisRevision}`,
    ] as const,
  predictions: () => [...analyzerQueryKeys.all, 'predictions'] as const,
  offlineResources: () => [...analyzerQueryKeys.all, 'offline-resources'] as const,
  kernelProfile: (profileId: string, resource: 'descriptor' | 'curve') =>
    [...analyzerQueryKeys.offlineResources(), 'kernel-profile', profileId, resource] as const,
  kernelMeasurement: (measurementId: string, resource: 'descriptor' | 'summary') =>
    [
      ...analyzerQueryKeys.offlineResources(),
      'kernel-measurement',
      measurementId,
      resource,
    ] as const,
  hardwareGpu: (gpuName: string) => [...analyzerQueryKeys.all, 'hardware', 'gpu', gpuName] as const,
  predictionDescriptor: (predictionId: string) =>
    [...analyzerQueryKeys.predictions(), predictionId, 'descriptor'] as const,
  predictionCases: (predictionId: string, offset: number, limit: number) =>
    [...analyzerQueryKeys.predictions(), predictionId, 'cases', offset, limit] as const,
  predictionCostTree: (predictionId: string, caseId: string, operationId: string) =>
    [
      ...analyzerQueryKeys.predictions(),
      predictionId,
      'case',
      caseId,
      'operation',
      operationId,
      'cost-tree',
    ] as const,
  predictionKernelAnalysis: (
    predictionId: string,
    caseId: string,
    operationId: string,
    leafId: number,
  ) =>
    [
      ...analyzerQueryKeys.predictionCostTree(predictionId, caseId, operationId),
      'leaf',
      leafId,
      'kernel-throughput-analysis',
    ] as const,
  predictionKernelInputDistribution: (predictionId: string) =>
    [...analyzerQueryKeys.predictions(), predictionId, 'kernel-input-distribution'] as const,
  predictionOptimality: (
    predictionId: string,
    caseId: string,
    resource: 'kernel-ladder' | 'waterfall',
    mode: OptimalityMode,
  ) =>
    [
      ...analyzerQueryKeys.predictions(),
      predictionId,
      'case',
      caseId,
      'optimality',
      resource,
      mode,
    ] as const,
  alignments: () => [...analyzerQueryKeys.all, 'alignments'] as const,
  alignmentDescriptor: (alignmentId: string) =>
    [...analyzerQueryKeys.alignments(), alignmentId, 'descriptor'] as const,
  alignmentSubject: (alignmentId: string, subject: AlignmentSubjectName, leaf: string) =>
    [...analyzerQueryKeys.alignments(), alignmentId, 'subject', subject, leaf] as const,
  alignmentIteration: (alignmentId: string, subject: AlignmentSubjectName, iterationId: number) =>
    [
      ...analyzerQueryKeys.alignments(),
      alignmentId,
      'subject',
      subject,
      'iteration',
      iterationId,
    ] as const,
  alignmentSequence: (alignmentId: string, phase: string, sequenceId: string) =>
    [
      ...analyzerQueryKeys.alignments(),
      alignmentId,
      'subject',
      'iteration',
      'sequence',
      phase,
      sequenceId,
    ] as const,
  workerOperations: (
    runId: string,
    worker: WorkerRef,
    offset: number,
    limit: number,
    schemaVersion: number,
    analysisRevision: string,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      worker.poolTag,
      worker.workerId,
      'operations',
      offset,
      limit,
      `schema-v${schemaVersion}`,
      `analysis-${analysisRevision}`,
    ] as const,
  workerOperationSeek: (
    runId: string,
    worker: WorkerRef,
    atMs: number,
    limit: number,
    schemaVersion: number,
    analysisRevision: string,
  ) =>
    [
      ...analyzerQueryKeys.runs(),
      runId,
      'worker',
      worker.poolTag,
      worker.workerId,
      'operation-seek',
      atMs,
      limit,
      `schema-v${schemaVersion}`,
      `analysis-${analysisRevision}`,
    ] as const,
  core: (runId: string, descriptorFingerprint: string) =>
    [...analyzerQueryKeys.runs(), runId, 'active-core', descriptorFingerprint] as const,
};

export function useOfflineResourcesQuery() {
  const repository = useAnalyzerRepository();
  const supported = repository.listOfflineResources !== undefined;
  return useQuery({
    queryKey: analyzerQueryKeys.offlineResources(),
    queryFn: () => repository.listOfflineResources!(),
    enabled: supported,
    refetchInterval: CATALOG_POLL_INTERVAL_MS,
  });
}

export function useKernelProfileQueries(profileId: string | null) {
  const repository = useAnalyzerRepository();
  const enabled =
    profileId !== null &&
    repository.getKernelProfileDescriptor !== undefined &&
    repository.getKernelProfileCurve !== undefined;
  const descriptor = useQuery({
    queryKey: analyzerQueryKeys.kernelProfile(profileId ?? 'missing', 'descriptor'),
    queryFn: () => repository.getKernelProfileDescriptor!(profileId!),
    enabled,
  });
  const curve = useQuery({
    queryKey: analyzerQueryKeys.kernelProfile(profileId ?? 'missing', 'curve'),
    queryFn: () => repository.getKernelProfileCurve!(profileId!),
    enabled,
  });
  return { descriptor, curve, supported: enabled || profileId === null };
}

export function useKernelMeasurementQueries(measurementId: string | null) {
  const repository = useAnalyzerRepository();
  const enabled =
    measurementId !== null &&
    repository.getKernelMeasurementDescriptor !== undefined &&
    repository.getKernelMeasurementSummary !== undefined;
  const descriptor = useQuery({
    queryKey: analyzerQueryKeys.kernelMeasurement(measurementId ?? 'missing', 'descriptor'),
    queryFn: () => repository.getKernelMeasurementDescriptor!(measurementId!),
    enabled,
  });
  const summary = useQuery({
    queryKey: analyzerQueryKeys.kernelMeasurement(measurementId ?? 'missing', 'summary'),
    queryFn: () => repository.getKernelMeasurementSummary!(measurementId!),
    enabled,
  });
  return { descriptor, summary, supported: enabled || measurementId === null };
}

export function useHardwareGpuQuery(gpuName: string | null) {
  const repository = useAnalyzerRepository();
  const enabled = gpuName !== null && repository.getHardwareGpu !== undefined;
  return useQuery({
    queryKey: analyzerQueryKeys.hardwareGpu(gpuName ?? 'missing'),
    queryFn: () => repository.getHardwareGpu!(gpuName!),
    enabled,
  });
}

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

function useDescriptorOverviewResource<Resource>(
  descriptor: RunDescriptor | undefined,
  name: 'model' | 'workload',
  load: (runId: string) => Promise<Resource>,
): OverviewResourceResult<Resource> {
  const artifact = descriptor?.[name];
  const supportedSchemaVersions = name === 'model' ? [1, 2] : [1];
  const supported =
    artifact?.schemaVersion === undefined ||
    supportedSchemaVersions.includes(artifact.schemaVersion);
  const query = useQuery({
    queryKey:
      descriptor !== undefined && artifact !== undefined
        ? analyzerQueryKeys.overviewResource(
            descriptor.runId,
            name,
            artifact.href,
            artifact.schemaVersion ?? 1,
          )
        : [...analyzerQueryKeys.runs(), descriptor?.runId ?? 'no-run', name, 'not-declared'],
    queryFn: () => {
      if (descriptor === undefined || artifact === undefined) {
        throw new Error(`Cannot load undeclared ${name} resource.`);
      }
      return load(descriptor.runId);
    },
    enabled: descriptor !== undefined && artifact !== undefined && supported,
    staleTime: Infinity,
  });

  if (descriptor === undefined) return { status: 'pending', reason: 'Waiting for run descriptor.' };
  if (artifact === undefined) {
    return { status: 'not_generated', reason: `Run descriptor does not declare ${name}.` };
  }
  if (!supported) {
    return {
      status: 'incompatible',
      reason: `The UI supports ${name} schema ${supportedSchemaVersions.map((version) => `v${version}`).join('/')}, not v${artifact.schemaVersion}.`,
    };
  }
  if (query.isError) {
    if (query.error instanceof AnalyzerV1OverviewResourceError) {
      return { status: 'incompatible', reason: query.error.message };
    }
    return {
      status: 'failed',
      code: stableErrorCode(query.error),
      reason: query.error instanceof Error ? query.error.message : `Could not load ${name}.`,
    };
  }
  if (query.data === undefined) return { status: 'pending', reason: `Loading ${name} resource.` };
  return { status: 'ready', resource: query.data };
}

export function useDescriptorModelQuery(
  descriptor: RunDescriptor | undefined,
): OverviewResourceResult<ModelConfigResource> {
  const repository = useAnalyzerRepository();
  return useDescriptorOverviewResource(descriptor, 'model', (runId) =>
    repository.getRunModel(runId),
  );
}

export function useDescriptorWorkloadQuery(
  descriptor: RunDescriptor | undefined,
): OverviewResourceResult<WorkloadOverviewResource> {
  const repository = useAnalyzerRepository();
  return useDescriptorOverviewResource(descriptor, 'workload', (runId) =>
    repository.getRunWorkload(runId),
  );
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

export function useSweepListQuery() {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.sweeps(),
    queryFn: () => repository.listSweeps(),
    refetchInterval: CATALOG_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: LIFECYCLE_REFETCH_ON_WINDOW_FOCUS,
  });
}

export function useSweepQuery(sweepId: string | null, enabled = true) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey:
      sweepId === null
        ? [...analyzerQueryKeys.sweeps(), 'no-selection']
        : analyzerQueryKeys.sweep(sweepId),
    queryFn: () => {
      if (sweepId === null) throw new Error('Cannot load a sweep without a selected id.');
      return repository.getSweep(sweepId);
    },
    enabled: enabled && sweepId !== null,
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
  variant: string | undefined,
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
  if (variant !== undefined && artifact.variants?.[variant] === undefined) {
    return {
      subject,
      status: 'not_generated',
      reason: `Run descriptor does not declare variant ${variant} for this analyzer subject.`,
    };
  }

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
  variant?: string,
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
            variant,
          ),
    queryFn: (): Promise<SubjectResult<Name>> => {
      if (request === null) {
        throw new Error(`Subject query ${subject} is not loadable from this descriptor.`);
      }
      return repository.getSubject(request.runId, subject, variant);
    },
    enabled: request !== null,
    staleTime: Infinity,
  });

  return resolveSubjectResult(descriptor, subject, variant, {
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
  ref: WorkerCostTreeRef | undefined,
  schemaVersion: number | undefined,
  analysisRevision: string | undefined,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey:
      ref === undefined
        ? [...analyzerQueryKeys.runs(), runId, 'worker', 'no-selection', 'cost-tree']
        : schemaVersion === undefined
          ? [...analyzerQueryKeys.runs(), runId, 'worker-cost-tree', 'unversioned']
          : analysisRevision === undefined
            ? [
                ...analyzerQueryKeys.runs(),
                runId,
                'worker',
                ref.worker.poolTag,
                ref.worker.workerId,
                'cost-tree',
                `schema-v${schemaVersion}`,
                'unrevisioned',
              ]
            : analyzerQueryKeys.workerCostTreeDetail(runId, ref, schemaVersion, analysisRevision),
    queryFn: () => {
      if (ref === undefined) {
        throw new Error(
          'Cannot load a worker CostTree detail without an exact operation identity.',
        );
      }
      return repository.getWorkerCostTree(runId, ref);
    },
    enabled:
      enabled &&
      runId.length > 0 &&
      ref !== undefined &&
      schemaVersion !== undefined &&
      analysisRevision !== undefined,
    staleTime: Infinity,
  });
}

export function useKernelThroughputAnalysisQuery(
  runId: string,
  ref: WorkerCostTreeRef | undefined,
  leafId: number | null,
  analysisRevision: string | undefined,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getKernelThroughputAnalysis !== undefined;
  const ready = supported && ref !== undefined && leafId !== null && analysisRevision !== undefined;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.kernelThroughputAnalysis(runId, ref, leafId, analysisRevision)
      : [...analyzerQueryKeys.runs(), runId, 'kernel-throughput-analysis', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getKernelThroughputAnalysis === undefined) {
        throw new Error('Kernel throughput analysis requires the live Analyzer service.');
      }
      return repository.getKernelThroughputAnalysis(runId, ref, leafId);
    },
    enabled: enabled && ready,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function useIterationOptimalityKernelLadderQuery(
  runId: string,
  worker: WorkerRef | undefined,
  iterId: string | undefined,
  analysisRevision: string | undefined,
  mode: OptimalityMode,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getIterationOptimalityKernelLadder !== undefined;
  const ready =
    supported && worker !== undefined && iterId !== undefined && analysisRevision !== undefined;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.iterationOptimalityKernelLadder(
          runId,
          worker,
          iterId,
          mode,
          analysisRevision,
        )
      : [...analyzerQueryKeys.runs(), runId, 'iteration-optimality-kernel-ladder', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getIterationOptimalityKernelLadder === undefined) {
        throw new Error('Iteration optimality requires the live Analyzer service.');
      }
      return repository.getIterationOptimalityKernelLadder(runId, worker, iterId, mode);
    },
    enabled: enabled && ready,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function useIterationOptimalityWaterfallQuery(
  runId: string,
  worker: WorkerRef | undefined,
  iterId: string | undefined,
  analysisRevision: string | undefined,
  mode: OptimalityMode,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getIterationOptimalityWaterfall !== undefined;
  const ready =
    supported && worker !== undefined && iterId !== undefined && analysisRevision !== undefined;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.iterationOptimalityWaterfall(
          runId,
          worker,
          iterId,
          mode,
          analysisRevision,
        )
      : [...analyzerQueryKeys.runs(), runId, 'iteration-optimality-waterfall', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getIterationOptimalityWaterfall === undefined) {
        throw new Error('Iteration optimality waterfall requires the live Analyzer service.');
      }
      return repository.getIterationOptimalityWaterfall(runId, worker, iterId, mode);
    },
    enabled: enabled && ready,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function usePredictionDescriptorQuery(predictionId: string) {
  const repository = useAnalyzerRepository();
  const supported = repository.getPredictionDescriptor !== undefined;
  const query = useQuery({
    queryKey: analyzerQueryKeys.predictionDescriptor(predictionId),
    queryFn: () => {
      if (repository.getPredictionDescriptor === undefined) {
        throw new Error('Timing prediction requires the live Analyzer service.');
      }
      return repository.getPredictionDescriptor(predictionId);
    },
    enabled: supported && predictionId.length > 0,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function usePredictionCasesQuery(predictionId: string, offset: number, limit: number) {
  const repository = useAnalyzerRepository();
  const supported = repository.getPredictionCases !== undefined;
  const query = useQuery({
    queryKey: analyzerQueryKeys.predictionCases(predictionId, offset, limit),
    queryFn: () => {
      if (repository.getPredictionCases === undefined) {
        throw new Error('Timing prediction cases require the live Analyzer service.');
      }
      return repository.getPredictionCases(predictionId, { offset, limit });
    },
    enabled: supported && predictionId.length > 0,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function usePredictionCostTreeQuery(
  predictionId: string,
  caseId: string | undefined,
  operationId: string | undefined,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getPredictionCostTree !== undefined;
  const ready = supported && caseId !== undefined && operationId !== undefined;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.predictionCostTree(predictionId, caseId, operationId)
      : [...analyzerQueryKeys.predictions(), predictionId, 'cost-tree', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getPredictionCostTree === undefined) {
        throw new Error('Prediction CostTree requires a selected case and operation.');
      }
      return repository.getPredictionCostTree(predictionId, caseId, operationId);
    },
    enabled: ready,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function usePredictionKernelAnalysisQuery(
  predictionId: string,
  caseId: string | undefined,
  operationId: string | undefined,
  leafId: number | null,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getPredictionKernelThroughputAnalysis !== undefined;
  const ready = supported && caseId !== undefined && operationId !== undefined && leafId !== null;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.predictionKernelAnalysis(predictionId, caseId, operationId, leafId)
      : [...analyzerQueryKeys.predictions(), predictionId, 'kernel-analysis', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getPredictionKernelThroughputAnalysis === undefined) {
        throw new Error('Prediction kernel analysis requires a selected leaf.');
      }
      return repository.getPredictionKernelThroughputAnalysis(
        predictionId,
        caseId,
        operationId,
        leafId,
      );
    },
    enabled: ready,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function usePredictionKernelInputDistributionQuery(predictionId: string, enabled: boolean) {
  const repository = useAnalyzerRepository();
  const supported = repository.getPredictionKernelInputDistribution !== undefined;
  const query = useQuery({
    queryKey: analyzerQueryKeys.predictionKernelInputDistribution(predictionId),
    queryFn: () => {
      if (repository.getPredictionKernelInputDistribution === undefined) {
        throw new Error('Prediction input distribution requires the live Analyzer service.');
      }
      return repository.getPredictionKernelInputDistribution(predictionId);
    },
    enabled: supported && enabled,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function usePredictionOptimalityQueries(
  predictionId: string,
  caseId: string | undefined,
  mode: OptimalityMode,
) {
  const repository = useAnalyzerRepository();
  const ladderSupported = repository.getPredictionOptimalityKernelLadder !== undefined;
  const waterfallSupported = repository.getPredictionOptimalityWaterfall !== undefined;
  const ready = caseId !== undefined;
  const ladder = useQuery({
    queryKey:
      ready && ladderSupported
        ? analyzerQueryKeys.predictionOptimality(predictionId, caseId, 'kernel-ladder', mode)
        : [...analyzerQueryKeys.predictions(), predictionId, 'optimality-ladder', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getPredictionOptimalityKernelLadder === undefined) {
        throw new Error('Prediction optimality ladder requires a selected case.');
      }
      return repository.getPredictionOptimalityKernelLadder(predictionId, caseId, mode);
    },
    enabled: ready && ladderSupported,
    staleTime: Infinity,
  });
  const waterfall = useQuery({
    queryKey:
      ready && waterfallSupported
        ? analyzerQueryKeys.predictionOptimality(predictionId, caseId, 'waterfall', mode)
        : [...analyzerQueryKeys.predictions(), predictionId, 'optimality-waterfall', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getPredictionOptimalityWaterfall === undefined) {
        throw new Error('Prediction optimality waterfall requires a selected case.');
      }
      return repository.getPredictionOptimalityWaterfall(predictionId, caseId, mode);
    },
    enabled: ready && waterfallSupported,
    staleTime: Infinity,
  });
  return {
    ladder: Object.assign(ladder, { supported: ladderSupported }),
    waterfall: Object.assign(waterfall, { supported: waterfallSupported }),
  };
}

/** One alignment subject document.
 *
 * Each subject is fetched on its own because the two analysis halves are
 * independent: a bundle with only the kernel half must still render its
 * kernel-half sections rather than fail as a whole. */
function useAlignmentSubjectQuery<Value>(
  alignmentId: string,
  subject: AlignmentSubjectName,
  leaf: 'report' | 'payload',
  read: ((alignmentId: string) => Promise<Value>) | undefined,
  enabled = true,
) {
  const supported = read !== undefined;
  const query = useQuery({
    queryKey: analyzerQueryKeys.alignmentSubject(alignmentId, subject, leaf),
    queryFn: () => {
      if (read === undefined) {
        throw new Error('Alignment analysis requires the live Analyzer service.');
      }
      return read(alignmentId);
    },
    enabled: supported && enabled && alignmentId.length > 0,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function useAlignmentDescriptorQuery(alignmentId: string) {
  const repository = useAnalyzerRepository();
  const supported = repository.getAlignmentDescriptor !== undefined;
  const query = useQuery({
    queryKey: analyzerQueryKeys.alignmentDescriptor(alignmentId),
    queryFn: () => {
      if (repository.getAlignmentDescriptor === undefined) {
        throw new Error('Alignment bundles require the live Analyzer service.');
      }
      return repository.getAlignmentDescriptor(alignmentId);
    },
    enabled: supported && alignmentId.length > 0,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function useAlignmentIterationReportQuery(alignmentId: string, enabled = true) {
  const repository = useAnalyzerRepository();
  return useAlignmentSubjectQuery(
    alignmentId,
    'iteration',
    'report',
    repository.getAlignmentIterationReport?.bind(repository),
    enabled,
  );
}

export function useAlignmentIterationSeriesQuery(alignmentId: string, enabled = true) {
  const repository = useAnalyzerRepository();
  return useAlignmentSubjectQuery(
    alignmentId,
    'iteration',
    'payload',
    repository.getAlignmentIterationSeries?.bind(repository),
    enabled,
  );
}

export function useAlignmentTimelineIndexQuery(alignmentId: string, enabled = true) {
  const repository = useAnalyzerRepository();
  return useAlignmentSubjectQuery(
    alignmentId,
    'timeline',
    'payload',
    repository.getAlignmentTimelineIndex?.bind(repository),
    enabled,
  );
}

export function useAlignmentWorkloadSeriesQuery(alignmentId: string, enabled = true) {
  const repository = useAnalyzerRepository();
  return useAlignmentSubjectQuery(
    alignmentId,
    'workload',
    'payload',
    repository.getAlignmentWorkloadSeries?.bind(repository),
    enabled,
  );
}

export function useAlignmentE2eSeriesQuery(alignmentId: string, enabled = true) {
  const repository = useAnalyzerRepository();
  return useAlignmentSubjectQuery(
    alignmentId,
    'e2e',
    'payload',
    repository.getAlignmentE2eSeries?.bind(repository),
    enabled,
  );
}

/** One iteration out of the timeline shard. Held forever once read: the
 * picker walks back and forth over a handful of iterations and each is a
 * separate range read on the service. */
export function useAlignmentTimelineIterationQuery(
  alignmentId: string,
  iterationId: number | null,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getAlignmentTimelineIteration !== undefined;
  const ready = iterationId !== null;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.alignmentIteration(alignmentId, 'timeline', iterationId)
      : [...analyzerQueryKeys.alignments(), alignmentId, 'timeline-iteration', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getAlignmentTimelineIteration === undefined) {
        throw new Error('An alignment iteration requires a selected iteration.');
      }
      return repository.getAlignmentTimelineIteration(alignmentId, iterationId);
    },
    enabled: supported && ready && alignmentId.length > 0,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function useAlignmentBreakdownQuery(alignmentId: string, iterationId: number | null) {
  const repository = useAnalyzerRepository();
  const supported = repository.getAlignmentBreakdown !== undefined;
  const ready = iterationId !== null;
  const query = useQuery({
    queryKey: ready
      ? analyzerQueryKeys.alignmentIteration(alignmentId, 'iteration', iterationId)
      : [...analyzerQueryKeys.alignments(), alignmentId, 'breakdown', 'not-ready'],
    queryFn: () => {
      if (!ready || repository.getAlignmentBreakdown === undefined) {
        throw new Error('An alignment breakdown requires a selected iteration.');
      }
      return repository.getAlignmentBreakdown(alignmentId, iterationId);
    },
    enabled: supported && ready && alignmentId.length > 0,
    staleTime: Infinity,
  });
  return Object.assign(query, { supported });
}

export function useAlignmentSequenceQueries(
  alignmentId: string,
  selections: readonly { readonly phase: string; readonly sequenceId: string }[],
  enabled = true,
) {
  const repository = useAnalyzerRepository();
  const supported = repository.getAlignmentSequence !== undefined;
  const queries = useQueries({
    queries: selections.map(({ phase, sequenceId }) => ({
      queryKey: analyzerQueryKeys.alignmentSequence(alignmentId, phase, sequenceId),
      queryFn: () => {
        if (repository.getAlignmentSequence === undefined) {
          throw new Error('This Analyzer repository does not serve alignment sequences.');
        }
        return repository.getAlignmentSequence(alignmentId, phase, sequenceId);
      },
      enabled: supported && enabled && alignmentId.length > 0,
      staleTime: Infinity,
    })),
  });
  return Object.assign(queries, { supported });
}

export function useWorkerOperationsQuery(
  runId: string,
  worker: WorkerRef | undefined,
  offset: number,
  limit: number,
  schemaVersion: number | undefined,
  analysisRevision: string | undefined,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  const ready =
    worker !== undefined && schemaVersion !== undefined && analysisRevision !== undefined;
  return useQuery({
    queryKey: ready
      ? analyzerQueryKeys.workerOperations(
          runId,
          worker,
          offset,
          limit,
          schemaVersion,
          analysisRevision,
        )
      : [...analyzerQueryKeys.runs(), runId, 'worker-operations', 'not-ready'],
    queryFn: async () => {
      if (worker === undefined) throw new Error('Cannot load operations without a WorkerRef.');
      const interactionId = currentTimelineInteractionId();
      const startedAt = performance.now();
      timelineProfileEvent(
        'operation-range-query-start',
        { poolTag: worker.poolTag, workerId: worker.workerId, offset, limit, mode: 'visible' },
        interactionId,
      );
      try {
        const page = await repository.getWorkerOperations(runId, worker, { offset, limit });
        timelineProfileEvent(
          'operation-range-query-end',
          {
            poolTag: worker.poolTag,
            workerId: worker.workerId,
            offset,
            limit,
            mode: 'visible',
            durationMs: performance.now() - startedAt,
            returned: page.operations.length,
          },
          interactionId,
        );
        return page;
      } catch (error) {
        timelineProfileEvent(
          'operation-range-query-error',
          { offset, limit, mode: 'visible', durationMs: performance.now() - startedAt },
          interactionId,
        );
        throw error;
      }
    },
    enabled: enabled && ready,
    staleTime: Infinity,
  });
}

/** Builds the initial 192-operation buffer from three bounded 64-operation
 * range requests. Later navigation refills only one directional chunk. */
export function useWorkerOperationBootstrapQuery(
  runId: string,
  worker: WorkerRef | undefined,
  viewportLimit: number,
  schemaVersion: number | undefined,
  analysisRevision: string | undefined,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  const ready =
    worker !== undefined && schemaVersion !== undefined && analysisRevision !== undefined;
  return useQuery({
    queryKey: ready
      ? [
          ...analyzerQueryKeys.runs(),
          runId,
          'worker',
          worker.poolTag,
          worker.workerId,
          'operation-bootstrap',
          viewportLimit,
          `schema-v${schemaVersion}`,
          `analysis-${analysisRevision}`,
        ]
      : [...analyzerQueryKeys.runs(), runId, 'worker-operation-bootstrap', 'not-ready'],
    queryFn: async (): Promise<WorkerOperationBuffer> => {
      if (worker === undefined) throw new Error('Cannot bootstrap operations without a worker.');
      const first = await repository.getWorkerOperations(runId, worker, {
        offset: 0,
        limit: viewportLimit,
      });
      const offsets = [viewportLimit, viewportLimit * 2].filter((offset) => offset < first.total);
      const remaining = await Promise.all(
        offsets.map((offset) =>
          repository.getWorkerOperations(runId, worker, { offset, limit: viewportLimit }),
        ),
      );
      return Object.freeze({
        ...first,
        operations: Object.freeze([
          ...first.operations,
          ...remaining.flatMap((range) => range.operations),
        ]),
      });
    },
    enabled: enabled && ready,
    staleTime: Infinity,
  });
}

/** One canonical cache identity/fetch contract shared by the visible range and
 * directional refill. Keeping it here prevents prefetch semantics from
 * drifting from the normal worker operation request. */
export function workerOperationsQueryOptions(
  repository: AnalyzerRepository,
  runId: string,
  worker: WorkerRef,
  offset: number,
  limit: number,
  schemaVersion: number,
  analysisRevision: string,
) {
  return queryOptions({
    queryKey: analyzerQueryKeys.workerOperations(
      runId,
      worker,
      offset,
      limit,
      schemaVersion,
      analysisRevision,
    ),
    queryFn: async () => {
      const interactionId = currentTimelineInteractionId();
      const startedAt = performance.now();
      timelineProfileEvent(
        'operation-range-query-start',
        { poolTag: worker.poolTag, workerId: worker.workerId, offset, limit, mode: 'prefetch' },
        interactionId,
      );
      try {
        const page = await repository.getWorkerOperations(runId, worker, { offset, limit });
        timelineProfileEvent(
          'operation-range-query-end',
          {
            poolTag: worker.poolTag,
            workerId: worker.workerId,
            offset,
            limit,
            mode: 'prefetch',
            durationMs: performance.now() - startedAt,
            returned: page.operations.length,
          },
          interactionId,
        );
        return page;
      } catch (error) {
        timelineProfileEvent(
          'operation-range-query-error',
          { offset, limit, mode: 'prefetch', durationMs: performance.now() - startedAt },
          interactionId,
        );
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export function useWorkerOperationSeekQuery(
  runId: string,
  worker: WorkerRef | undefined,
  atMs: number | null,
  limit: number,
  schemaVersion: number | undefined,
  analysisRevision: string | undefined,
  enabled: boolean,
) {
  const repository = useAnalyzerRepository();
  const ready =
    worker !== undefined &&
    atMs !== null &&
    Number.isFinite(atMs) &&
    atMs >= 0 &&
    Number.isSafeInteger(limit) &&
    limit > 0 &&
    schemaVersion !== undefined &&
    analysisRevision !== undefined;
  return useQuery({
    queryKey: ready
      ? analyzerQueryKeys.workerOperationSeek(
          runId,
          worker,
          atMs,
          limit,
          schemaVersion,
          analysisRevision,
        )
      : [...analyzerQueryKeys.runs(), runId, 'worker-operation-seek', 'not-ready'],
    queryFn: async () => {
      if (worker === undefined || atMs === null) {
        throw new Error('Cannot seek operations without a WorkerRef and wall-clock time.');
      }
      const interactionId = currentTimelineInteractionId();
      const startedAt = performance.now();
      timelineProfileEvent(
        'seek-query-start',
        { poolTag: worker.poolTag, workerId: worker.workerId, atMs, limit },
        interactionId,
      );
      try {
        const seek = await repository.getWorkerOperationSeek(runId, worker, atMs, limit);
        timelineProfileEvent(
          'seek-query-end',
          {
            poolTag: worker.poolTag,
            workerId: worker.workerId,
            atMs,
            limit,
            durationMs: performance.now() - startedAt,
            hits: seek.hits.length,
            bufferOffset: seek.buffer.offset,
          },
          interactionId,
        );
        return seek;
      } catch (error) {
        timelineProfileEvent(
          'seek-query-error',
          { atMs, limit, durationMs: performance.now() - startedAt },
          interactionId,
        );
        throw error;
      }
    },
    enabled: enabled && ready,
    staleTime: Infinity,
    // Slider seeks are ephemeral identities. Keep a brief back-scrub cache but
    // do not retain one entry for every paused cursor position indefinitely.
    gcTime: 30_000,
  });
}
