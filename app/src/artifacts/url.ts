/**
 * Ref to URL. A pure function, so every address the application fetches can be
 * asserted in a unit test without a server, a mock, or a fetch interceptor.
 *
 * Concentrating URL construction here is also what makes the Analyzer's
 * addressing changes (`new-design.md` §五 A2/A5) a one-file edit instead of a
 * search through call sites.
 */
import type { ResultKind, ResultRef } from '../location';
import {
  operationSequenceWorker,
  type ArtifactRef,
  type OperationSequenceRequest,
  type SeqRef,
  type WorkerCoordinate,
} from './ref';

/**
 * The Analyzer's read API.
 *
 * Relative on purpose: the dev server proxies this prefix and the deployment
 * serves the UI from the same origin, so there is no host to configure and no
 * CORS surface. The prefix names the service, so the conversation backend can
 * be mounted beside it without either one owning bare `/api/`.
 */
const API_BASE = '/api/analyzer/v1/';

/**
 * Catalog routes, one per result kind.
 *
 * The six are already uniform on the server — a plural, hyphenated collection
 * name — so this table records the spelling rather than papering over six
 * different shapes.
 */
const CATALOG_PATH: Record<ResultKind, string> = {
  run: 'runs',
  sweep: 'sweeps',
  prediction: 'predictions',
  alignment: 'alignments',
  kernelProfile: 'kernel-profiles',
  kernelMeasurement: 'kernel-measurements',
};

/**
 * Every token that becomes a path segment goes through this.
 *
 * Result ids and pool tags are opaque server strings — `20260715_1_test` today,
 * something else tomorrow — so they are escaped rather than validated. A token
 * containing a slash then addresses one segment instead of silently becoming
 * two, which is the difference between a failed read and a read of the wrong
 * thing.
 *
 * What escaping cannot fix is `.` and `..`: they are unreserved, so this
 * function returns them unchanged, and even a hand-written `%2E%2E` is decoded
 * and then resolved away by the URL parser. Those are refused where the token
 * enters the application instead — `pathToken` in `location/types.ts`, applied
 * by every schema that decodes an addressable identity — because a URL builder
 * has no way to report a problem that has already happened.
 */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The scope prefix for one result.
 *
 * `?rev=` pins the read to an analysis revision (A2), which is what makes the
 * response cacheable forever. It is appended by the callers below rather than
 * here, because it is a query and this returns a path.
 */
function resultPath(result: ResultRef): string {
  return `${API_BASE}${CATALOG_PATH[result.kind]}/${segment(result.id)}`;
}

function workerPath(result: ResultRef, worker: WorkerCoordinate): string {
  return `${resultPath(result)}/workers/${segment(worker.poolTag)}/${segment(worker.workerId)}`;
}

/** `?rev=<revision>` when the address pins one, nothing when it means latest. */
function revision(result: ResultRef): string {
  return result.revision === undefined ? '' : `?rev=${encodeURIComponent(result.revision)}`;
}

function query(result: ResultRef, entries: readonly (readonly [string, string])[]): string {
  const params = [
    ...entries,
    ...(result.revision === undefined ? [] : ([['rev', result.revision]] as const)),
  ];
  return `?${params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`;
}

export function sequenceUrl(ref: SeqRef, request: OperationSequenceRequest): string {
  switch (ref.seq) {
    case 'operations': {
      const base = `${workerPath(ref.result, operationSequenceWorker(ref))}/subjects/operations`;
      return request.mode === 'range'
        ? `${base}/payload${query(ref.result, [
            ['offset', String(request.offset)],
            ['limit', String(request.limit)],
          ])}`
        : `${base}/seek${query(ref.result, [['at_ms', String(request.atMs)]])}`;
    }
  }
}

export function artifactUrl(ref: ArtifactRef): string {
  switch (ref.kind) {
    case 'catalog':
      return `${API_BASE}${CATALOG_PATH[ref.of]}`;
    case 'sweepAnalysis':
      return `${resultPath(ref.result)}/subjects/sweep/payload${revision(ref.result)}`;
    case 'alignmentDescriptor':
      return `${resultPath(ref.result)}/descriptor${revision(ref.result)}`;
    case 'alignmentIterationReport':
      return `${resultPath(ref.result)}/subjects/iteration/report${revision(ref.result)}`;
    case 'alignmentIterationSeries':
      return `${resultPath(ref.result)}/subjects/iteration/payload${revision(ref.result)}`;
    case 'alignmentTimelineIndex':
      return `${resultPath(ref.result)}/subjects/timeline/payload${revision(ref.result)}`;
    case 'alignmentWorkloadSeries':
      return `${resultPath(ref.result)}/subjects/workload/payload${revision(ref.result)}`;
    case 'alignmentE2eSeries':
      return `${resultPath(ref.result)}/subjects/e2e/payload${revision(ref.result)}`;
    case 'alignmentBreakdown':
      return `${resultPath(ref.result)}/subjects/iteration/iterations/${ref.iterationId}${revision(ref.result)}`;
    case 'alignmentTimelineIteration':
      return `${resultPath(ref.result)}/subjects/timeline/iterations/${ref.iterationId}${query(ref.result, [['projection', 'reference-lane']])}`;
    case 'alignmentSequence':
      return `${resultPath(ref.result)}/subjects/iteration/sequences/${segment(ref.phase)}/${segment(ref.sequenceId)}${revision(ref.result)}`;
    case 'predictionDescriptor':
      return `${resultPath(ref.result)}/descriptor${revision(ref.result)}`;
    case 'predictionCases':
      return `${resultPath(ref.result)}/subjects/cases/payload${query(ref.result, [
        ['offset', String(ref.offset)],
        ['limit', String(ref.limit)],
      ])}`;
    case 'predictionCostTree':
      return `${resultPath(ref.result)}/cases/${segment(ref.caseId)}/operations/${segment(ref.operationId)}/subjects/cost-tree/payload${revision(ref.result)}`;
    case 'predictionKernelThroughputAnalysis':
      return `${resultPath(ref.result)}/cases/${segment(ref.caseId)}/operations/${segment(ref.operationId)}/leaves/${ref.leafId}/subjects/kernel-throughput-analysis/payload${revision(ref.result)}`;
    case 'predictionOptimalityKernelLadder':
      return `${resultPath(ref.result)}/cases/${segment(ref.caseId)}/subjects/optimality-kernel-ladder/payload${query(ref.result, [['mode', ref.mode]])}`;
    case 'predictionOptimalityWaterfall':
      return `${resultPath(ref.result)}/cases/${segment(ref.caseId)}/subjects/optimality-waterfall/payload${query(ref.result, [['mode', ref.mode]])}`;
    case 'workerCostTree': {
      const operation = ref.operation;
      return `${workerPath(ref.result, ref.worker)}/operations/${segment(operation.iterId)}/${segment(operation.batchId)}/${segment(operation.operationId)}/subjects/cost-tree/payload${revision(ref.result)}`;
    }
    case 'kernelThroughputAnalysis': {
      const operation = ref.operation;
      return `${workerPath(ref.result, ref.worker)}/operations/${segment(operation.iterId)}/${segment(operation.batchId)}/${segment(operation.operationId)}/leaves/${ref.leafId}/subjects/kernel-throughput-analysis/payload${revision(ref.result)}`;
    }
    case 'kernelTimeShare':
      return `${resultPath(ref.result)}/subjects/kernel-time-share/payload${revision(ref.result)}`;
    case 'workerKernelTimeShare':
      return `${workerPath(ref.result, ref.worker)}/subjects/kernel-time-share/payload${revision(ref.result)}`;
    case 'runSummary':
      // A `report` rather than a `payload`: the summary is the simulator's own
      // document, passed through, and the Analyzer spells that distinction in
      // the route.
      return `${resultPath(ref.result)}/subjects/summary/report${revision(ref.result)}`;
    case 'runLatency':
      return `${resultPath(ref.result)}/subjects/slo-general/payload${revision(ref.result)}`;
    case 'runConcurrency':
      return `${resultPath(ref.result)}/subjects/concurrency/payload${revision(ref.result)}`;
    case 'runDescriptor':
      return `${resultPath(ref.result)}/descriptor${revision(ref.result)}`;
    case 'kernelInputDistribution':
      return `${resultPath(ref.result)}/subjects/kernel-input-distribution/payload${revision(ref.result)}`;
    case 'topology':
      return `${resultPath(ref.result)}/subjects/topology/payload${revision(ref.result)}`;
    case 'runModel':
      return `${resultPath(ref.result)}/subjects/model/payload${revision(ref.result)}`;
    case 'runWorkload':
      return `${resultPath(ref.result)}/subjects/workload/payload${revision(ref.result)}`;
    case 'requestState':
      // The `report`, not the payload beside it: the payload is the same
      // populations as 200 bins per category per worker, and this build shows
      // the summary. See `RequestStateRef`.
      return `${resultPath(ref.result)}/subjects/request-state/report${revision(ref.result)}`;
    case 'requestStateSeries':
      return `${resultPath(ref.result)}/subjects/request-state/payload${revision(ref.result)}`;
    case 'utilization':
      // The `report` again: the payload is the busy fraction of every pool and
      // every worker in 200 time bins, and this build shows the run average.
      return `${resultPath(ref.result)}/subjects/utilization/report${revision(ref.result)}`;
    case 'utilizationSeries':
      return `${resultPath(ref.result)}/subjects/utilization/payload${revision(ref.result)}`;
    case 'kvOccupancy':
      // The `report` again: the payload is four token levels in 200 bins for
      // every shard of every pool, and this build shows the peaks.
      return `${resultPath(ref.result)}/subjects/kv-occupancy/report${revision(ref.result)}`;
    case 'kvOccupancySeries':
      return `${resultPath(ref.result)}/subjects/kv-occupancy/payload${revision(ref.result)}`;
    case 'batchComposition':
      // The `report` again: the payload beside it is up to 4,000 scatter points
      // per pool and per worker, and this build shows the distribution.
      return `${resultPath(ref.result)}/subjects/batch/report${revision(ref.result)}`;
    case 'batchSeries':
      return `${resultPath(ref.result)}/subjects/batch/payload${revision(ref.result)}`;
    case 'runThroughput':
      // The `report` again: the payload beside it is the same series shaped for
      // a plot, and this build reads the segments and the totals.
      return `${resultPath(ref.result)}/subjects/throughput/report${revision(ref.result)}`;
    case 'throughputSeries':
      return `${resultPath(ref.result)}/subjects/throughput/payload${revision(ref.result)}`;
    case 'conservation':
      // The `report` is the whole subject here: twelve checks and their
      // verdicts, with no series beside it.
      return `${resultPath(ref.result)}/subjects/workload-conservation/report${revision(ref.result)}`;
    case 'runOptimality':
      return ref.mode === 'batch_locked'
        ? `${resultPath(ref.result)}/subjects/optimality/variants/batch_locked/payload${revision(ref.result)}`
        : `${resultPath(ref.result)}/subjects/optimality/payload${revision(ref.result)}`;
    case 'iterationOptimalityKernelLadder':
      return `${workerPath(ref.result, ref.worker)}/iterations/${segment(ref.iterId)}/subjects/optimality-kernel-ladder/payload${query(ref.result, [['mode', ref.mode]])}`;
    case 'iterationOptimalityWaterfall':
      return `${workerPath(ref.result, ref.worker)}/iterations/${segment(ref.iterId)}/subjects/optimality-waterfall/payload${query(ref.result, [['mode', ref.mode]])}`;
    case 'kernelProfileDescriptor':
      return `${resultPath(ref.result)}/descriptor`;
    case 'kernelProfileCurve':
      return `${resultPath(ref.result)}/subjects/curve/payload`;
    case 'kernelMeasurementDescriptor':
      return `${resultPath(ref.result)}/descriptor`;
    case 'kernelMeasurementSummary':
      return `${resultPath(ref.result)}/subjects/summary/report`;
    case 'hardwareGpu':
      return `${API_BASE}hardware/gpus?name=${encodeURIComponent(ref.name)}`;
  }
}
