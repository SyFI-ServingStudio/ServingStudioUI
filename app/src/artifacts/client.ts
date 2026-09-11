/**
 * The one place an artifact is fetched.
 *
 * Everything a read can go wrong in is turned into one of the six
 * `ArtifactResult` states here, so no panel ever sees a `Response`, a status
 * code, or a thrown `ZodError`. The mapping is the whole content of this file
 * and is stated once rather than re-decided per call site.
 */
import { z } from 'zod';

import {
  IncompatibleWorkerCostTreeError,
  WORKER_COST_TREE_SCHEMA_VERSION,
  parseWorkerCostTree,
} from './schema/workerCostTree';
import {
  IncompatibleKernelThroughputAnalysisError,
  KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
  parseKernelThroughputAnalysis,
  parsePredictionKernelThroughputAnalysis,
} from './schema/kernelThroughputAnalysis';
import {
  IncompatiblePredictionError,
  PREDICTION_SCHEMA_VERSION,
  parsePredictionCases,
  parsePredictionCostTree,
  parsePredictionDescriptor,
} from './schema/prediction';
import {
  decodeAnalyzerV1OptimalityPayload,
  decodeAnalyzerV1IterationOptimalityKernelLadder,
  decodeAnalyzerV1IterationOptimalityWaterfall,
  IncompatiblePredictionOptimalityError,
  parsePredictionOptimalityKernelLadder,
  parsePredictionOptimalityWaterfall,
} from './schema/optimality';
import { AnalyzerV1SweepContractError, parseAnalyzerV1SweepPayload } from './schema/sweep';
import {
  IncompatibleScopedOptimalityError,
  SCOPED_OPTIMALITY_SCHEMA_VERSION,
  parseAnalyzerV1ScopedOptimality,
} from './schema/scopedOptimality';
import {
  parseAnalyzerV1AlignmentBreakdown,
  parseAnalyzerV1AlignmentDescriptor,
  parseAnalyzerV1AlignmentE2eSeries,
  parseAnalyzerV1AlignmentIterationReport,
  parseAnalyzerV1AlignmentIterationSeries,
  parseAnalyzerV1AlignmentSequence,
  parseAnalyzerV1AlignmentTimelineIndex,
  parseAnalyzerV1AlignmentTimelineIteration,
  parseAnalyzerV1AlignmentWorkloadSeries,
} from './schema/alignment';

import {
  CONCURRENCY_SCHEMA_VERSION,
  IncompatibleConcurrencyError,
  UnavailableConcurrencyError,
  parseConcurrency,
} from './schema/concurrency';
import {
  IncompatibleKernelInputDistributionError,
  KERNEL_INPUT_DISTRIBUTION_SCHEMA_VERSION,
  UnavailableKernelInputDistributionError,
  parseKernelInputDistribution,
} from './schema/kernelInputDistribution';
import {
  AnalyzerV1RunDescriptorError,
  AnalyzerV1RunDescriptorIdentityError,
  parseAnalyzerV1RunDescriptor,
} from './schema/descriptor';
import {
  IncompatibleOfflineArtifactError,
  OfflineArtifactIdentityError,
  parseHardwareGpu,
  parseKernelMeasurementDescriptor,
  parseKernelMeasurementSummary,
  parseKernelProfileCurve,
  parseKernelProfileDescriptor,
} from './schema/offlineResource';

import { IncompatibleCatalogError, parseCatalog } from './schema/catalog';
import {
  IncompatibleKernelTimeShareError,
  KERNEL_TIME_SHARE_SCHEMA_VERSION,
  UnavailableKernelTimeShareError,
  parseKernelTimeShare,
  parseWorkerKernelTimeShare,
} from './schema/kernelTimeShare';
import {
  IncompatibleRunModelError,
  RUN_MODEL_SCHEMA_VERSION,
  parseRunModel,
} from './schema/runModel';
import {
  IncompatibleRunWorkloadError,
  RUN_WORKLOAD_SCHEMA_VERSION,
  parseRunWorkload,
} from './schema/workload';
import {
  IncompatibleRequestStateError,
  REQUEST_STATE_SCHEMA_VERSION,
  UnavailableRequestStateError,
  parseRequestState,
  parseRequestStateSeries,
} from './schema/requestState';
import {
  IncompatibleRunOverviewError,
  RUN_LATENCY_SCHEMA_VERSION,
  parseRunLatency,
  parseRunSummary,
} from './schema/runOverview';
import {
  IncompatibleKvOccupancyError,
  KV_OCCUPANCY_SCHEMA_VERSION,
  UnavailableKvOccupancyError,
  parseKvOccupancy,
  parseKvOccupancySeries,
} from './schema/kvOccupancy';
import {
  BATCH_COMPOSITION_SCHEMA_VERSION,
  IncompatibleBatchCompositionError,
  UnavailableBatchCompositionError,
  parseBatchComposition,
  parseBatchSeries,
} from './schema/batchComposition';
import {
  IncompatibleRunThroughputError,
  RUN_THROUGHPUT_SCHEMA_VERSION,
  UnavailableRunThroughputError,
  parseRunThroughput,
  parseThroughputSeries,
} from './schema/throughput';
import {
  CONSERVATION_SCHEMA_VERSION,
  IncompatibleConservationError,
  UnavailableConservationError,
  parseConservation,
} from './schema/conservation';
import {
  IncompatibleUtilizationError,
  UTILIZATION_SCHEMA_VERSION,
  UnavailableUtilizationError,
  parseUtilization,
  parseUtilizationSeries,
} from './schema/utilization';
import {
  IncompatibleTopologyError,
  TOPOLOGY_SCHEMA_VERSION,
  parseTopology,
} from './schema/topology';
import type { ArtifactRef } from './ref';
import type { ArtifactResult } from './result';
import { artifactUrl } from './url';

/** What a successful decode yields, before it becomes a `ready` result. */
interface Decoded {
  readonly value: unknown;
  readonly schemaVersion: number;
  readonly revision: string;
}

function alignmentSchemaVersion(body: unknown): number {
  return z.object({ schema_version: z.number().int() }).parse(body).schema_version;
}

/** Convert the validator notation used by HTTP into the bare revision token
 * accepted by `?rev=`. The response wins over a requested revision because a
 * stale pin still receives the current body from analyzer-v1. */
export function responseRevision(headers: Headers, fallback = ''): string {
  const etag = headers.get('etag')?.trim();
  if (etag === undefined) return fallback;

  const quoted = /^(?:W\/)?"([^"]+)"$/.exec(etag);
  return quoted?.[1] ?? etag;
}

/**
 * Decode a response body for one ref kind.
 *
 * `headers` is passed in because the revision is a property of the response,
 * not of the body: A2 makes it the `ETag`, and until then each kind falls back
 * to whatever in its own body identifies the read.
 */
function decode(ref: ArtifactRef, body: unknown, headers: Headers): Decoded {
  switch (ref.kind) {
    case 'catalog': {
      const parsed = parseCatalog(ref.of, body);
      return {
        value: parsed.value,
        schemaVersion: parsed.schemaVersion,
        revision: responseRevision(headers, parsed.generatedAt ?? ''),
      };
    }
    case 'sweepAnalysis':
      return {
        value: parseAnalyzerV1SweepPayload(body, ref.result),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentDescriptor':
      return {
        value: parseAnalyzerV1AlignmentDescriptor(body, ref.result.id),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentIterationReport':
      return {
        value: parseAnalyzerV1AlignmentIterationReport(body),
        schemaVersion: alignmentSchemaVersion(body),
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentIterationSeries':
      return {
        value: parseAnalyzerV1AlignmentIterationSeries(body),
        schemaVersion: alignmentSchemaVersion(body),
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentTimelineIndex':
      return {
        value: parseAnalyzerV1AlignmentTimelineIndex(body),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentWorkloadSeries':
      return {
        value: parseAnalyzerV1AlignmentWorkloadSeries(body),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentE2eSeries':
      return {
        value: parseAnalyzerV1AlignmentE2eSeries(body),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentBreakdown':
      return {
        value: parseAnalyzerV1AlignmentBreakdown(body, ref.iterationId),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentTimelineIteration':
      return {
        value: parseAnalyzerV1AlignmentTimelineIteration(body, ref.iterationId),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'alignmentSequence':
      return {
        value: parseAnalyzerV1AlignmentSequence(body, ref.phase, ref.sequenceId),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'predictionDescriptor':
      return {
        value: parsePredictionDescriptor(body, ref.result.id),
        schemaVersion: PREDICTION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'predictionCases':
      return {
        value: parsePredictionCases(body, ref),
        schemaVersion: PREDICTION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'predictionCostTree':
      return {
        value: parsePredictionCostTree(body, ref),
        schemaVersion: PREDICTION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'predictionKernelThroughputAnalysis':
      return {
        value: parsePredictionKernelThroughputAnalysis(body, ref),
        schemaVersion: KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'predictionOptimalityKernelLadder':
      return {
        value: parsePredictionOptimalityKernelLadder(body, ref),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'predictionOptimalityWaterfall':
      return {
        value: parsePredictionOptimalityWaterfall(body, ref),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'workerCostTree':
      return {
        value: parseWorkerCostTree(body, ref),
        schemaVersion: WORKER_COST_TREE_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'kernelThroughputAnalysis':
      return {
        value: parseKernelThroughputAnalysis(body, ref),
        schemaVersion: KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'kernelTimeShare':
      return {
        value: parseKernelTimeShare(body),
        schemaVersion: KERNEL_TIME_SHARE_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'workerKernelTimeShare':
      return {
        value: parseWorkerKernelTimeShare(body, ref.worker),
        schemaVersion: KERNEL_TIME_SHARE_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runSummary':
      return {
        value: parseRunSummary(body),
        // The simulator's own document carries no version. Reporting 0 says
        // that plainly rather than inventing one that would look checked.
        schemaVersion: 0,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runLatency':
      return {
        value: parseRunLatency(body),
        schemaVersion: RUN_LATENCY_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runConcurrency':
      return {
        value: parseConcurrency(body),
        schemaVersion: CONCURRENCY_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runDescriptor': {
      const descriptor = parseAnalyzerV1RunDescriptor(body, {
        workspaceId: ref.result.workspace,
        runId: ref.result.id,
      });
      return {
        value: descriptor,
        schemaVersion: descriptor.protocolVersion,
        revision: responseRevision(
          headers,
          descriptor.analysis?.revision ?? ref.result.revision ?? '',
        ),
      };
    }
    case 'kernelInputDistribution':
      return {
        value: parseKernelInputDistribution(body),
        schemaVersion: KERNEL_INPUT_DISTRIBUTION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'topology':
      return {
        value: parseTopology(body),
        schemaVersion: TOPOLOGY_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runModel':
      return {
        value: parseRunModel(body),
        schemaVersion: RUN_MODEL_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runWorkload':
      return {
        value: parseRunWorkload(body),
        schemaVersion: RUN_WORKLOAD_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'requestState':
      return {
        value: parseRequestState(body),
        schemaVersion: REQUEST_STATE_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'requestStateSeries':
      return {
        value: parseRequestStateSeries(body),
        schemaVersion: REQUEST_STATE_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'utilization':
      return {
        value: parseUtilization(body),
        schemaVersion: UTILIZATION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'utilizationSeries':
      return {
        value: parseUtilizationSeries(body),
        schemaVersion: UTILIZATION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'batchComposition':
      return {
        value: parseBatchComposition(body),
        schemaVersion: BATCH_COMPOSITION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'batchSeries':
      return {
        value: parseBatchSeries(body),
        schemaVersion: BATCH_COMPOSITION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runThroughput':
      return {
        value: parseRunThroughput(body),
        schemaVersion: RUN_THROUGHPUT_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'throughputSeries':
      return {
        value: parseThroughputSeries(body),
        schemaVersion: RUN_THROUGHPUT_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'conservation':
      return {
        value: parseConservation(body),
        schemaVersion: CONSERVATION_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'runOptimality':
      return {
        value: decodeAnalyzerV1OptimalityPayload(body),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'scopedOptimality':
      return {
        value: parseAnalyzerV1ScopedOptimality(body),
        schemaVersion: SCOPED_OPTIMALITY_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'iterationOptimalityKernelLadder':
      return {
        value: decodeAnalyzerV1IterationOptimalityKernelLadder(body, ref.worker, ref.iterId),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'iterationOptimalityWaterfall':
      return {
        value: decodeAnalyzerV1IterationOptimalityWaterfall(body, ref.worker, ref.iterId),
        schemaVersion: 1,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'kvOccupancy':
      return {
        value: parseKvOccupancy(body),
        schemaVersion: KV_OCCUPANCY_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'kvOccupancySeries':
      return {
        value: parseKvOccupancySeries(body),
        schemaVersion: KV_OCCUPANCY_SCHEMA_VERSION,
        revision: responseRevision(headers, ref.result.revision),
      };
    case 'kernelProfileDescriptor': {
      const value = parseKernelProfileDescriptor(body, {
        workspaceId: ref.result.workspace,
        profileId: ref.result.id,
      });
      return {
        value,
        schemaVersion: value.schemaVersion,
        revision: responseRevision(headers),
      };
    }
    case 'kernelProfileCurve': {
      const value = parseKernelProfileCurve(body);
      return {
        value,
        schemaVersion: value.schemaVersion,
        revision: responseRevision(headers),
      };
    }
    case 'kernelMeasurementDescriptor': {
      const base = new URL('/api/analyzer/v1/', globalThis.location?.origin ?? 'http://localhost');
      const value = parseKernelMeasurementDescriptor(body, base, {
        workspaceId: ref.result.workspace,
        measurementId: ref.result.id,
      });
      return {
        value,
        schemaVersion: value.schemaVersion,
        revision: responseRevision(headers),
      };
    }
    case 'kernelMeasurementSummary': {
      const value = parseKernelMeasurementSummary(body);
      return {
        value,
        schemaVersion: value.schemaVersion,
        revision: responseRevision(headers),
      };
    }
    case 'hardwareGpu': {
      const value = parseHardwareGpu(body);
      if (value.requested !== ref.name) {
        throw new OfflineArtifactIdentityError([
          `expected GPU ${ref.name}, received ${value.requested}`,
        ]);
      }
      return {
        value,
        schemaVersion: value.schemaVersion,
        revision: responseRevision(headers),
      };
    }
  }
}

/**
 * HTTP status to result state.
 *
 * `404` is `unavailable`, not `failed`: for every address this module builds,
 * a missing route means the Analyzer serving this deployment predates the
 * artifact, which is a fact about the deployment and not an error the user
 * caused. `410` is the Analyzer's way of saying the analysis was never run, so
 * it maps to the state that says re-running would fix it.
 */
export function artifactResultFromStatus(
  status: number,
  statusText: string,
  url: string,
): ArtifactResult<never> {
  const where = `${status} ${statusText || 'error'} for ${url}`;
  if (status === 404 || status === 405 || status === 501) {
    return {
      status: 'unavailable',
      code: String(status),
      reason: `this Analyzer does not serve ${url}`,
    };
  }
  if (status === 410) return { status: 'not_generated', reason: where };
  return { status: 'failed', code: String(status), reason: where };
}

async function artifactResultFromResponse(
  response: Response,
  url: string,
  signal?: AbortSignal,
): Promise<ArtifactResult<never>> {
  try {
    const problem = z
      .object({
        code: z.string().optional(),
        detail: z.string().optional(),
        title: z.string().optional(),
      })
      .passthrough()
      .parse(await response.json());
    if (response.status === 404 && problem.code === 'artifact_missing') {
      return {
        status: 'not_generated',
        reason: problem.detail ?? problem.title ?? `Artifact was not generated for ${url}`,
      };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // A non-problem response still has a meaningful status mapping below.
  }
  return artifactResultFromStatus(response.status, response.statusText, url);
}

/**
 * Read one artifact.
 *
 * Returns rather than throws for every outcome except an aborted request: an
 * abort is the caller changing its mind, and turning that into a `failed` the
 * panel would render is a lie about the server. React Query re-throws it and
 * discards the result, which is what should happen.
 */
export async function fetchArtifact(
  ref: ArtifactRef,
  signal?: AbortSignal,
): Promise<ArtifactResult<unknown>> {
  const url = artifactUrl(ref);
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'failed', code: 'network', reason: messageOf(error) };
  }

  if (!response.ok) return artifactResultFromResponse(response, url, signal);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'failed', code: 'invalid_json', reason: messageOf(error) };
  }

  try {
    const decoded = decode(ref, body, response.headers);
    return {
      status: 'ready',
      value: decoded.value,
      schemaVersion: decoded.schemaVersion,
      revision: decoded.revision,
    };
  } catch (error) {
    if (ref.kind.startsWith('alignment')) {
      const received =
        typeof body === 'object' &&
        body !== null &&
        'schema_version' in body &&
        typeof body.schema_version === 'number' &&
        Number.isInteger(body.schema_version)
          ? body.schema_version
          : undefined;
      const issues =
        error instanceof z.ZodError
          ? error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          : [messageOf(error)];
      return {
        status: 'incompatible',
        reason: `alignment artifact is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
        received,
        issues,
      };
    }
    if (error instanceof IncompatibleCatalogError) {
      return { status: 'incompatible', reason: error.message, received: error.received };
    }
    if (error instanceof AnalyzerV1SweepContractError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatibleWorkerCostTreeError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatiblePredictionError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatiblePredictionOptimalityError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatibleScopedOptimalityError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatibleKernelThroughputAnalysisError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableKernelTimeShareError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleKernelTimeShareError) {
      return { status: 'incompatible', reason: error.message, received: error.received };
    }
    if (error instanceof IncompatibleRunOverviewError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatibleConcurrencyError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableConcurrencyError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof AnalyzerV1RunDescriptorError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof AnalyzerV1RunDescriptorIdentityError) {
      return {
        status: 'incompatible',
        reason: error.message,
        issues: error.issues,
      };
    }
    if (error instanceof OfflineArtifactIdentityError) {
      return {
        status: 'incompatible',
        reason: error.message,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatibleOfflineArtifactError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableKernelInputDistributionError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleKernelInputDistributionError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof IncompatibleTopologyError) {
      return { status: 'incompatible', reason: error.message, received: error.received };
    }
    if (error instanceof IncompatibleRunModelError) {
      return { status: 'incompatible', reason: error.message, received: error.received };
    }
    if (error instanceof IncompatibleRunWorkloadError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableRequestStateError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleRequestStateError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableUtilizationError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleUtilizationError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableKvOccupancyError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof UnavailableBatchCompositionError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleBatchCompositionError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableRunThroughputError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleRunThroughputError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof UnavailableConservationError) {
      return { status: 'unavailable', reason: error.reason };
    }
    if (error instanceof IncompatibleConservationError) {
      return { status: 'incompatible', reason: error.message, received: error.received };
    }
    if (error instanceof IncompatibleKvOccupancyError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    if (error instanceof z.ZodError) {
      return { status: 'failed', code: 'invalid_body', reason: describeIssues(error) };
    }
    throw error;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A few issues, with their paths, rather than zod's full dump.
 *
 * The path is the part that makes a schema mismatch actionable — it names the
 * field the server and this build disagree about — and three of them is enough
 * to see the shape of the disagreement in a UI surface that has one line.
 */
function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
    return `${path}: ${issue.message}`;
  });
  const more = error.issues.length - issues.length;
  return more > 0 ? `${issues.join('; ')} (+${more} more)` : issues.join('; ');
}
