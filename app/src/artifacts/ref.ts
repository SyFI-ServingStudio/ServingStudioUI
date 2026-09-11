/**
 * What an artifact read names.
 *
 * An `ArtifactRef` is a plain value: comparable, serializable, and enough on
 * its own to produce both a URL and a cache key. Nothing else is needed to read
 * an artifact — no repository handle, no ambient run, no provider. That is what
 * lets a panel be reached directly from a URL instead of only through the click
 * path that happened to populate a store.
 *
 * The union grows one member per ported artifact, not all at once: every
 * consumer switches exhaustively over it, so an unported kind is absent rather
 * than present-and-stubbed.
 */
import {
  segmentOf,
  type ResultId,
  type ResultKind,
  type ResultRef,
  type Segment,
} from '../location';
import type { RawCostNode } from './schema/costTree';
import type {
  HardwareGpu,
  KernelMeasurementDescriptor,
  KernelMeasurementSummary,
  KernelProfileCurve,
  KernelProfileDescriptor,
} from './schema/offlineResource';
import type {
  OptimalityDecodeResult,
  OptimalityIterationWaterfall,
  OptimalityKernelLadder,
  PredictionOptimalityKernelLadder,
  PredictionOptimalityWaterfall,
} from './schema/optimality';
import type { SweepAnalysis } from './schema/sweep';
import type {
  AlignmentBreakdown,
  AlignmentDescriptor,
  AlignmentE2eSeries,
  AlignmentIterationReport,
  AlignmentIterationSeries,
  AlignmentSequence,
  AlignmentTimelineIndex,
  AlignmentTimelineIteration,
  AlignmentWorkloadSeries,
} from './schema/alignmentTypes';

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * The list of results of one kind in one workspace.
 *
 * One ref per kind rather than one ref for "the catalog": the six lists are six
 * independent reads, and a deployment whose Analyzer predates a kind — or whose
 * read of that one kind failed — should still show the other five.
 */
export interface CatalogRef {
  readonly kind: 'catalog';
  readonly workspace: string;
  readonly of: ResultKind;
}

/**
 * A worker inside a result.
 *
 * Two fields, both opaque, because a worker id is unique only inside its pool.
 * Kept structural rather than reusing a branded key: this ref becomes two path
 * segments, and a key would have to be taken apart again to build them.
 */
export interface WorkerCoordinate {
  readonly poolTag: string;
  readonly workerId: string;
}

/** Exact identity of one raw worker-cost row. */
export interface OperationRef {
  readonly iterId: string;
  readonly batchId: string;
  readonly operationId: string;
}

/** One bounded timeline fact in the worker operation sequence. */
export interface OperationSummary {
  readonly ordinal: number;
  readonly ref: OperationRef;
  readonly section: string;
  readonly layer: number;
  readonly startMs: number;
  readonly endMs: number;
}

export type WorkerOperationKind = 'afd_attn' | 'afd_ffn' | 'iterwise';
export type WorkerOperationBatchRole = 'slot' | 'batch';

export interface WorkerOperationBuffer {
  readonly worker: WorkerCoordinate;
  readonly workerKind: WorkerOperationKind;
  readonly batchRole: WorkerOperationBatchRole;
  readonly span: { readonly startMs: number; readonly endMs: number };
  readonly offset: number;
  readonly total: number;
  readonly operations: readonly OperationSummary[];
}

export interface WorkerOperationSeekResult {
  readonly worker: WorkerCoordinate;
  readonly workerKind: WorkerOperationKind;
  readonly batchRole: WorkerOperationBatchRole;
  readonly atMs: number;
  readonly totalOperations: number;
  readonly span: { readonly startMs: number; readonly endMs: number };
  readonly hits: readonly OperationSummary[];
  readonly anchor: { readonly ordinal: number; readonly kind: 'hit' | 'nearest' };
  readonly suggestedViewport: { readonly offset: number; readonly limit: number };
  readonly buffer: WorkerOperationBuffer;
}

/** One exact operation's independently addressed CostTree document. */
export interface WorkerCostTreeRef {
  readonly kind: 'workerCostTree';
  readonly result: RunResultRef;
  readonly worker: WorkerCoordinate;
  readonly operation: OperationRef;
}

export interface WorkerCostTreeGroupInput {
  readonly batchTokens: number;
  readonly prefillTokens: number;
  readonly decodeRequestCount: number;
  readonly decodeKvTotal: number;
  readonly prefillChunkPairs: readonly (readonly [number, number])[];
}

export interface WorkerCostTreeInput {
  readonly section: string;
  readonly layer: number | null;
  readonly groups: readonly WorkerCostTreeGroupInput[];
}

export interface WorkerCostTreeDetail {
  readonly worker: WorkerCoordinate;
  readonly operation: OperationRef;
  readonly section: string;
  readonly layer: number;
  readonly interval: { readonly startMs: number; readonly endMs: number };
  readonly inputs: readonly WorkerCostTreeInput[];
  readonly tree: RawCostNode;
}

export interface PredictionDescriptor {
  readonly predictionId: string;
  readonly displayName: string;
  readonly selector: 'iter' | 'speculative_iter' | 'attn' | 'ffn';
  readonly archType: string;
  readonly gpu: { readonly name: string; readonly count: number };
  readonly caseCount: number;
  readonly lifecycle: {
    readonly prediction: 'pending' | 'complete';
    readonly analysis: 'not_started' | 'complete';
  };
  readonly kernelInputDistributionAvailable: boolean;
}

export interface PredictionOperationSummary {
  readonly operationId: string;
  readonly section: string;
  readonly layer: number;
  readonly timeMs: number;
}

export interface PredictionCase {
  readonly caseId: string;
  readonly input: JsonValue;
  readonly totalTimeMs: number;
  readonly operations: readonly PredictionOperationSummary[];
}

export interface PredictionCasePage {
  readonly predictionId: string;
  readonly offset: number;
  readonly total: number;
  readonly cases: readonly PredictionCase[];
}

export interface PredictionOperationRef {
  readonly predictionId: string;
  readonly caseId: string;
  readonly operationId: string;
}

export interface PredictionCostTreeDetail {
  readonly predictionId: string;
  readonly caseId: string;
  readonly operationId: string;
  readonly section: string;
  readonly layer: number;
  readonly interval: { readonly startMs: number; readonly endMs: number };
  readonly inputs: readonly WorkerCostTreeInput[];
  readonly tree: RawCostNode;
}

export interface PredictionDescriptorRef {
  readonly kind: 'predictionDescriptor';
  readonly result: ResultRef & { readonly kind: 'prediction' };
}

export interface PredictionCasesRef {
  readonly kind: 'predictionCases';
  readonly result: ResultRef & { readonly kind: 'prediction' };
  readonly offset: number;
  readonly limit: number;
}

export interface PredictionCostTreeRef {
  readonly kind: 'predictionCostTree';
  readonly result: ResultRef & { readonly kind: 'prediction' };
  readonly caseId: string;
  readonly operationId: string;
}

export interface PredictionKernelThroughputAnalysisRef {
  readonly kind: 'predictionKernelThroughputAnalysis';
  readonly result: ResultRef & { readonly kind: 'prediction' };
  readonly caseId: string;
  readonly operationId: string;
  readonly leafId: number;
}

export interface PredictionOptimalityKernelLadderRef {
  readonly kind: 'predictionOptimalityKernelLadder';
  readonly result: ResultRef & { readonly kind: 'prediction' };
  readonly caseId: string;
  readonly mode: 'unlocked' | 'batch_locked';
}

export interface PredictionOptimalityWaterfallRef {
  readonly kind: 'predictionOptimalityWaterfall';
  readonly result: ResultRef & { readonly kind: 'prediction' };
  readonly caseId: string;
  readonly mode: 'unlocked' | 'batch_locked';
}

/** The complete bounded aggregate grid for one sweep result. */
export interface SweepAnalysisRef {
  readonly kind: 'sweepAnalysis';
  readonly result: ResultRef & { readonly kind: 'sweep' };
}

/** One selected CostTree leaf evaluated across the simulator cache grid. */
export interface KernelThroughputAnalysisRef {
  readonly kind: 'kernelThroughputAnalysis';
  readonly result: RunResultRef;
  readonly worker: WorkerCoordinate;
  readonly operation: OperationRef;
  readonly leafId: number;
}

export interface KernelThroughputPoint {
  readonly input: Readonly<Record<string, number>>;
  readonly timeMs: number;
  readonly flops: number;
  readonly bytes: number;
  readonly energyJ: number;
  readonly coverage: number;
}

export interface KernelThroughputAnalysis {
  readonly worker: WorkerCoordinate;
  readonly operation: OperationRef;
  readonly schemaVersion: 1;
  readonly leafId: number;
  readonly slot: {
    readonly name: string;
    readonly kind: string;
    readonly kernelConfig: Readonly<Record<string, JsonValue>>;
    readonly backend: string | null;
  };
  readonly exactInput: JsonValue;
  readonly describeConfig: Readonly<Record<string, JsonValue>>;
  readonly inputFields: readonly string[];
  readonly gridAxes: readonly (readonly number[])[];
  readonly points: readonly KernelThroughputPoint[];
  readonly semantics: 'cache_eval_at_declared_grid';
}

export interface PredictionKernelThroughputAnalysis extends Omit<
  KernelThroughputAnalysis,
  'worker' | 'operation'
> {
  readonly predictionId: string;
  readonly caseId: string;
  readonly operationId: string;
}

/** The canonical address of one worker's globally ordered operation stream. */
export type OperationSequenceAt = readonly [
  Extract<Segment, { readonly at: 'pool' }>,
  Extract<Segment, { readonly at: 'worker' }>,
];

/**
 * A bounded sequence differs from an artifact: offset and seek reads are
 * windows over one logical stream, not independently named documents.
 */
export interface OperationsSeqRef {
  readonly seq: 'operations';
  /** `revision` is the descriptor's analysis revision. Individual range ETags
   * identify different bodies and must never be substituted here. */
  readonly result: RunResultRef;
  readonly at: OperationSequenceAt;
}

export type SeqRef = OperationsSeqRef;

export type OperationSequenceRequest =
  | { readonly mode: 'range'; readonly offset: number; readonly limit: number }
  | { readonly mode: 'seek'; readonly atMs: number };

/**
 * The critical-path kernel-time composition of a whole result.
 *
 * Carries `overall` and every pool in full, plus an index of the workers. The
 * workers' own compositions are addressed separately — see
 * `WorkerKernelTimeShareRef` — because that is the part that grows with the
 * size of the cluster.
 */
export interface KernelTimeShareRef {
  readonly kind: 'kernelTimeShare';
  readonly result: ResultRef;
}

/** One worker's kernel-time composition, at that worker's own address. */
export interface WorkerKernelTimeShareRef {
  readonly kind: 'workerKernelTimeShare';
  readonly result: ResultRef;
  readonly worker: WorkerCoordinate;
}

/**
 * What the run did, in one document: throughput, tokens, requests, wall time.
 *
 * The simulator's own summary rather than anything the analyzer computes, which
 * is why it has no schema version: it is the run's own report of itself.
 */
export interface RunSummaryRef {
  readonly kind: 'runSummary';
  readonly result: ResultRef;
}

/**
 * The three latency distributions a reader judges a run by.
 *
 * Separate from the summary because it is a different document with a different
 * fate: a run whose analysis has not produced latencies is still a run with a
 * throughput, and the overview says so rather than refusing to render.
 */
export interface RunLatencyRef {
  readonly kind: 'runLatency';
  readonly result: ResultRef;
}

/** The bounded request-concurrency backdrop used by the shared wall-clock scrubber. */
export interface RunConcurrencyRef {
  readonly kind: 'runConcurrency';
  readonly result: ResultRef;
}

/** Capability manifest for one run; it gates subject and exact-detail reads. */
export interface RunDescriptorRef {
  readonly kind: 'runDescriptor';
  readonly result: RunResultRef;
}

/** A run-only result address, used by artifacts whose sibling kinds publish a
 * different wire contract at the same path. */
export type RunResultRef = ResultRef & { readonly kind: 'run' };

/** Run- or prediction-wide backend choices grouped by exact CostTree position. */
export interface KernelInputDistributionRef {
  readonly kind: 'kernelInputDistribution';
  readonly result: ResultRef;
}

/**
 * What the run was made of: pools, the workers in them, and the GPUs under
 * those.
 *
 * The one read that says which addresses a run *has*. Every drill-down segment
 * a reader can reach — a pool tag, a worker id — is named here first, which is
 * why it is a run-level read rather than something each panel discovers from
 * whatever it happens to have loaded.
 */
export interface TopologyRef {
  readonly kind: 'topology';
  readonly result: ResultRef;
}

/**
 * The model configuration the run was given.
 *
 * A separate document from the topology because it is a separate fact: the
 * topology says how many replicas of a thing were run, and this says what that
 * thing was. A run whose model config could not be read still has a topology,
 * and the map draws it with the layer and expert counts left blank rather than
 * refusing.
 */
export interface RunModelRef {
  readonly kind: 'runModel';
  readonly result: ResultRef;
}

/** The configured request trace and the two bounded distributions shown in the overview. */
export interface RunWorkloadRef {
  readonly kind: 'runWorkload';
  readonly result: ResultRef;
}

/**
 * Where the run's requests were waiting, summarised.
 *
 * The *report*, not the series: the Analyzer publishes both, and the series is
 * 200 bins of every category on every worker. What a reader wants first is how
 * deep the queue got and whether it stayed there, which is two numbers per
 * population however large the cluster is.
 */
export interface RequestStateRef {
  readonly kind: 'requestState';
  readonly result: ResultRef;
}

/** Complete cluster, pool, and worker request-state timelines used by the existing charts. */
export interface RequestStateSeriesRef {
  readonly kind: 'requestStateSeries';
  readonly result: ResultRef;
}

/**
 * How busy the run's hardware was, summarised.
 *
 * The counterpart to `KernelTimeShareRef`: that one says how busy time was
 * divided, this one says how much of the clock was busy at all. A run can spend
 * 70% of its GPU time in attention and still have left the GPU idle for half
 * the run, and neither document can say so alone.
 */
export interface UtilizationRef {
  readonly kind: 'utilization';
  readonly result: ResultRef;
}

/** Complete pool and worker utilization timelines used by the existing chart. */
export interface UtilizationSeriesRef {
  readonly kind: 'utilizationSeries';
  readonly result: ResultRef;
}

/**
 * How full the run's KV cache ran, summarised.
 *
 * The memory counterpart to `UtilizationRef`. Between them and the queue, a
 * reader can tell a run that was short of compute from one that was short of
 * memory from one that was neither and was simply not being fed.
 */
export interface KvOccupancyRef {
  readonly kind: 'kvOccupancy';
  readonly result: ResultRef;
}

/** The complete KV occupancy timeline used by the existing chart. */
export interface KvOccupancySeriesRef {
  readonly kind: 'kvOccupancySeries';
  readonly result: ResultRef;
}

/**
 * How much work was in each kernel invocation.
 *
 * The question the utilization subject cannot answer: it says the GPU was busy,
 * and this says what it was busy with. A run at 99% utilization whose median
 * batch is one token is a run doing almost nothing per invocation, and the two
 * documents are read together or not at all.
 */
export interface BatchCompositionRef {
  readonly kind: 'batchComposition';
  readonly result: ResultRef;
}

/** Complete pool and worker invocation scatter used by the existing charts. */
export interface BatchSeriesRef {
  readonly kind: 'batchSeries';
  readonly result: ResultRef;
}

/**
 * What the run delivered, over the run.
 *
 * The overview's lead number examined. That number is a token rate averaged
 * over the whole logged window and summed across two kinds of token, and both
 * of those hide something a reader acts on: a run that served twice the rate
 * for half the time averages the same, and a prefill token and a decode token
 * are not the same work.
 */
export interface RunThroughputRef {
  readonly kind: 'runThroughput';
  readonly result: ResultRef;
}

/** Fine and coarse throughput timelines used by the existing chart. */
export interface ThroughputSeriesRef {
  readonly kind: 'throughputSeries';
  readonly result: ResultRef;
}

/**
 * Whether the run's own logs add up.
 *
 * The subject every other subject rests on. Each check restates a quantity two
 * ways — what the workload implies against what the log recorded — and a
 * disagreement means some number elsewhere on this page is describing a run
 * that did not happen. Cheap to read when it passes and the first thing to read
 * when it does not.
 */
export interface ConservationRef {
  readonly kind: 'conservation';
  readonly result: ResultRef;
}

/** The run-wide optimality waterfall and kernel ladders for one batch mode. */
export interface RunOptimalityRef {
  readonly kind: 'runOptimality';
  readonly result: RunResultRef;
  readonly mode: 'unlocked' | 'batch_locked';
}

export interface IterationOptimalityKernelLadderRef {
  readonly kind: 'iterationOptimalityKernelLadder';
  readonly result: RunResultRef;
  readonly worker: WorkerCoordinate;
  readonly iterId: string;
  readonly mode: 'unlocked' | 'batch_locked';
}

export interface IterationOptimalityWaterfallRef {
  readonly kind: 'iterationOptimalityWaterfall';
  readonly result: RunResultRef;
  readonly worker: WorkerCoordinate;
  readonly iterId: string;
  readonly mode: 'unlocked' | 'batch_locked';
}

type CurrentOfflineResult<K extends 'kernelProfile' | 'kernelMeasurement'> = Omit<
  ResultRef,
  'kind' | 'revision'
> & {
  readonly kind: K;
  readonly revision?: never;
};

export interface KernelProfileDescriptorRef {
  readonly kind: 'kernelProfileDescriptor';
  readonly result: CurrentOfflineResult<'kernelProfile'>;
}

export interface KernelProfileCurveRef {
  readonly kind: 'kernelProfileCurve';
  readonly result: CurrentOfflineResult<'kernelProfile'>;
}

export interface KernelMeasurementDescriptorRef {
  readonly kind: 'kernelMeasurementDescriptor';
  readonly result: CurrentOfflineResult<'kernelMeasurement'>;
}

export interface KernelMeasurementSummaryRef {
  readonly kind: 'kernelMeasurementSummary';
  readonly result: CurrentOfflineResult<'kernelMeasurement'>;
}

/** Hardware metadata is selected by the descriptor rather than a result id. */
export interface HardwareGpuRef {
  readonly kind: 'hardwareGpu';
  readonly name: string;
}

type AlignmentResultRef = ResultRef & { readonly kind: 'alignment' };
export interface AlignmentDescriptorRef {
  readonly kind: 'alignmentDescriptor';
  readonly result: AlignmentResultRef;
}
export interface AlignmentIterationReportRef {
  readonly kind: 'alignmentIterationReport';
  readonly result: AlignmentResultRef;
}
export interface AlignmentIterationSeriesRef {
  readonly kind: 'alignmentIterationSeries';
  readonly result: AlignmentResultRef;
}
export interface AlignmentTimelineIndexRef {
  readonly kind: 'alignmentTimelineIndex';
  readonly result: AlignmentResultRef;
}
export interface AlignmentWorkloadSeriesRef {
  readonly kind: 'alignmentWorkloadSeries';
  readonly result: AlignmentResultRef;
}
export interface AlignmentE2eSeriesRef {
  readonly kind: 'alignmentE2eSeries';
  readonly result: AlignmentResultRef;
}
export interface AlignmentBreakdownRef {
  readonly kind: 'alignmentBreakdown';
  readonly result: AlignmentResultRef;
  readonly iterationId: number;
}
export interface AlignmentTimelineIterationRef {
  readonly kind: 'alignmentTimelineIteration';
  readonly result: AlignmentResultRef;
  readonly iterationId: number;
}
export interface AlignmentSequenceRef {
  readonly kind: 'alignmentSequence';
  readonly result: AlignmentResultRef;
  readonly phase: string;
  readonly sequenceId: string;
}

export type ArtifactRef =
  | CatalogRef
  | SweepAnalysisRef
  | PredictionDescriptorRef
  | PredictionCasesRef
  | PredictionCostTreeRef
  | PredictionKernelThroughputAnalysisRef
  | PredictionOptimalityKernelLadderRef
  | PredictionOptimalityWaterfallRef
  | WorkerCostTreeRef
  | KernelThroughputAnalysisRef
  | KernelTimeShareRef
  | WorkerKernelTimeShareRef
  | RunSummaryRef
  | RunLatencyRef
  | RunConcurrencyRef
  | RunDescriptorRef
  | KernelInputDistributionRef
  | TopologyRef
  | RunModelRef
  | RunWorkloadRef
  | RequestStateRef
  | RequestStateSeriesRef
  | UtilizationRef
  | UtilizationSeriesRef
  | KvOccupancyRef
  | KvOccupancySeriesRef
  | BatchCompositionRef
  | BatchSeriesRef
  | RunThroughputRef
  | ThroughputSeriesRef
  | ConservationRef
  | RunOptimalityRef
  | IterationOptimalityKernelLadderRef
  | IterationOptimalityWaterfallRef
  | KernelProfileDescriptorRef
  | KernelProfileCurveRef
  | KernelMeasurementDescriptorRef
  | KernelMeasurementSummaryRef
  | HardwareGpuRef
  | AlignmentDescriptorRef
  | AlignmentIterationReportRef
  | AlignmentIterationSeriesRef
  | AlignmentTimelineIndexRef
  | AlignmentWorkloadSeriesRef
  | AlignmentE2eSeriesRef
  | AlignmentBreakdownRef
  | AlignmentTimelineIterationRef
  | AlignmentSequenceRef;

/** Anything a panel can declare that it reads. */
export type ReadRef = ArtifactRef | SeqRef;

/**
 * A stable string identity for a ref, used as the cache key.
 *
 * A list, written out in a fixed order by the code below rather than read off
 * an object — `JSON.stringify` of an object depends on property insertion
 * order, so two refs equal as values could miss each other in the cache. What
 * the list buys over joining the fields with a separator is that result ids,
 * revisions and worker tokens are opaque: they may contain the separator, and
 * then `("a/b", "c")` and `("a", "b/c")` name the same cache entry. Serving one
 * result's numbers under another result's address is the cache mistake with no
 * symptom — the page renders, and it is wrong.
 */
export function artifactKey(ref: ArtifactRef): string {
  switch (ref.kind) {
    case 'catalog':
      return JSON.stringify(['catalog', ref.workspace, ref.of]);
    case 'sweepAnalysis':
      return JSON.stringify(['sweep-analysis', ...resultParts(ref.result)]);
    case 'alignmentDescriptor':
    case 'alignmentIterationReport':
    case 'alignmentIterationSeries':
    case 'alignmentTimelineIndex':
    case 'alignmentWorkloadSeries':
    case 'alignmentE2eSeries':
      return JSON.stringify([ref.kind, ...resultParts(ref.result)]);
    case 'alignmentBreakdown':
    case 'alignmentTimelineIteration':
      return JSON.stringify([ref.kind, ...resultParts(ref.result), ref.iterationId]);
    case 'alignmentSequence':
      return JSON.stringify([ref.kind, ...resultParts(ref.result), ref.phase, ref.sequenceId]);
    case 'predictionDescriptor':
      return JSON.stringify(['prediction-descriptor', ...resultParts(ref.result)]);
    case 'predictionCases':
      return JSON.stringify([
        'prediction-cases',
        ...resultParts(ref.result),
        ref.offset,
        ref.limit,
      ]);
    case 'predictionCostTree':
      return JSON.stringify([
        'prediction-cost-tree',
        ...resultParts(ref.result),
        ref.caseId,
        ref.operationId,
      ]);
    case 'predictionKernelThroughputAnalysis':
      return JSON.stringify([
        'prediction-kernel-throughput-analysis',
        ...resultParts(ref.result),
        ref.caseId,
        ref.operationId,
        ref.leafId,
      ]);
    case 'predictionOptimalityKernelLadder':
      return JSON.stringify([
        'prediction-optimality-kernel-ladder',
        ...resultParts(ref.result),
        ref.caseId,
        ref.mode,
      ]);
    case 'predictionOptimalityWaterfall':
      return JSON.stringify([
        'prediction-optimality-waterfall',
        ...resultParts(ref.result),
        ref.caseId,
        ref.mode,
      ]);
    case 'workerCostTree':
      return JSON.stringify([
        'worker-cost-tree',
        ...resultParts(ref.result),
        ref.worker.poolTag,
        ref.worker.workerId,
        ref.operation.iterId,
        ref.operation.batchId,
        ref.operation.operationId,
      ]);
    case 'kernelThroughputAnalysis':
      return JSON.stringify([
        'kernel-throughput-analysis',
        ...resultParts(ref.result),
        ref.worker.poolTag,
        ref.worker.workerId,
        ref.operation.iterId,
        ref.operation.batchId,
        ref.operation.operationId,
        ref.leafId,
      ]);
    case 'kernelTimeShare':
      return JSON.stringify(['kernel-time-share', ...resultParts(ref.result)]);
    case 'workerKernelTimeShare':
      return JSON.stringify([
        'worker-kernel-time-share',
        ...resultParts(ref.result),
        ref.worker.poolTag,
        ref.worker.workerId,
      ]);
    case 'runSummary':
      return JSON.stringify(['run-summary', ...resultParts(ref.result)]);
    case 'runLatency':
      return JSON.stringify(['run-latency', ...resultParts(ref.result)]);
    case 'runConcurrency':
      return JSON.stringify(['run-concurrency', ...resultParts(ref.result)]);
    case 'runDescriptor':
      return JSON.stringify(['run-descriptor', ...resultParts(ref.result)]);
    case 'kernelInputDistribution':
      return JSON.stringify(['kernel-input-distribution', ...resultParts(ref.result)]);
    case 'topology':
      return JSON.stringify(['topology', ...resultParts(ref.result)]);
    case 'runModel':
      return JSON.stringify(['run-model', ...resultParts(ref.result)]);
    case 'runWorkload':
      return JSON.stringify(['run-workload', ...resultParts(ref.result)]);
    case 'requestState':
      return JSON.stringify(['request-state', ...resultParts(ref.result)]);
    case 'requestStateSeries':
      return JSON.stringify(['request-state-series', ...resultParts(ref.result)]);
    case 'utilization':
      return JSON.stringify(['utilization', ...resultParts(ref.result)]);
    case 'utilizationSeries':
      return JSON.stringify(['utilization-series', ...resultParts(ref.result)]);
    case 'kvOccupancy':
      return JSON.stringify(['kv-occupancy', ...resultParts(ref.result)]);
    case 'kvOccupancySeries':
      return JSON.stringify(['kv-occupancy-series', ...resultParts(ref.result)]);
    case 'batchComposition':
      return JSON.stringify(['batch', ...resultParts(ref.result)]);
    case 'batchSeries':
      return JSON.stringify(['batch-series', ...resultParts(ref.result)]);
    case 'runThroughput':
      return JSON.stringify(['throughput', ...resultParts(ref.result)]);
    case 'throughputSeries':
      return JSON.stringify(['throughput-series', ...resultParts(ref.result)]);
    case 'conservation':
      return JSON.stringify(['conservation', ...resultParts(ref.result)]);
    case 'runOptimality':
      return JSON.stringify(['run-optimality', ...resultParts(ref.result), ref.mode]);
    case 'iterationOptimalityKernelLadder':
    case 'iterationOptimalityWaterfall':
      return JSON.stringify([
        ref.kind,
        ...resultParts(ref.result),
        ref.worker.poolTag,
        ref.worker.workerId,
        ref.iterId,
        ref.mode,
      ]);
    case 'kernelProfileDescriptor':
      return JSON.stringify(['kernel-profile-descriptor', ...resultParts(ref.result)]);
    case 'kernelProfileCurve':
      return JSON.stringify(['kernel-profile-curve', ...resultParts(ref.result)]);
    case 'kernelMeasurementDescriptor':
      return JSON.stringify(['kernel-measurement-descriptor', ...resultParts(ref.result)]);
    case 'kernelMeasurementSummary':
      return JSON.stringify(['kernel-measurement-summary', ...resultParts(ref.result)]);
    case 'hardwareGpu':
      return JSON.stringify(['hardware-gpu', ref.name]);
  }
}

/** Whether a serialized artifact key belongs to one alignment's timeline
 * index or any of its already-read iteration details. */
export function isAlignmentTimelineArtifactKey(
  key: string,
  result: ResultRef & { readonly kind: 'alignment' },
): boolean {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(parts)) return false;
  return (
    (parts[0] === 'alignmentTimelineIndex' || parts[0] === 'alignmentTimelineIteration') &&
    parts[1] === result.workspace &&
    parts[2] === result.kind &&
    parts[3] === result.id &&
    parts[4] === (result.revision ?? null)
  );
}

/** Stable identity of a logical sequence, independent of its current window. */
export function sequenceKey(ref: SeqRef): string {
  switch (ref.seq) {
    case 'operations': {
      const worker = operationSequenceWorker(ref);
      return JSON.stringify([
        'operations',
        ...resultParts(ref.result),
        worker.poolTag,
        worker.workerId,
      ]);
    }
  }
}

export function sequenceReadKey(ref: SeqRef, request: OperationSequenceRequest): string {
  const requestParts =
    request.mode === 'range' ? ['range', request.offset, request.limit] : ['seek', request.atMs];
  return JSON.stringify([sequenceKey(ref), ...requestParts]);
}

export function readKey(ref: ReadRef): string {
  return 'kind' in ref ? artifactKey(ref) : sequenceKey(ref);
}

/**
 * The revision is part of the key.
 *
 * Without it a re-analysis would be served from the previous analysis's cache
 * under the same run id — the one cache mistake that shows the user numbers
 * from a run that no longer exists. An absent revision is `null` rather than
 * the word `latest`, because `latest` is also a revision a caller may pin to,
 * and the two are different reads: one follows the result, the other does not.
 */
function resultParts(result: ResultRef): readonly (string | null)[] {
  return [result.workspace, result.kind, result.id, result.revision ?? null];
}

export function catalogRef(workspace: string, of: ResultKind): CatalogRef {
  return { kind: 'catalog', workspace, of };
}

export function sweepAnalysisRef(result: ResultRef & { readonly kind: 'sweep' }): SweepAnalysisRef {
  return { kind: 'sweepAnalysis', result };
}

export const alignmentDescriptorRef = (result: AlignmentResultRef): AlignmentDescriptorRef => ({
  kind: 'alignmentDescriptor',
  result,
});
export const alignmentIterationReportRef = (
  result: AlignmentResultRef,
): AlignmentIterationReportRef => ({ kind: 'alignmentIterationReport', result });
export const alignmentIterationSeriesRef = (
  result: AlignmentResultRef,
): AlignmentIterationSeriesRef => ({ kind: 'alignmentIterationSeries', result });
export const alignmentTimelineIndexRef = (
  result: AlignmentResultRef,
): AlignmentTimelineIndexRef => ({ kind: 'alignmentTimelineIndex', result });
export const alignmentWorkloadSeriesRef = (
  result: AlignmentResultRef,
): AlignmentWorkloadSeriesRef => ({ kind: 'alignmentWorkloadSeries', result });
export const alignmentE2eSeriesRef = (result: AlignmentResultRef): AlignmentE2eSeriesRef => ({
  kind: 'alignmentE2eSeries',
  result,
});
export const alignmentBreakdownRef = (
  result: AlignmentResultRef,
  iterationId: number,
): AlignmentBreakdownRef => ({ kind: 'alignmentBreakdown', result, iterationId });
export const alignmentTimelineIterationRef = (
  result: AlignmentResultRef,
  iterationId: number,
): AlignmentTimelineIterationRef => ({ kind: 'alignmentTimelineIteration', result, iterationId });
export const alignmentSequenceRef = (
  result: AlignmentResultRef,
  phase: string,
  sequenceId: string,
): AlignmentSequenceRef => ({ kind: 'alignmentSequence', result, phase, sequenceId });

export function predictionDescriptorRef(
  result: ResultRef & { readonly kind: 'prediction' },
): PredictionDescriptorRef {
  return { kind: 'predictionDescriptor', result };
}

export function predictionCasesRef(
  result: ResultRef & { readonly kind: 'prediction' },
  offset: number,
  limit: number,
): PredictionCasesRef {
  return { kind: 'predictionCases', result, offset, limit };
}

export function predictionCostTreeRef(
  result: ResultRef & { readonly kind: 'prediction' },
  caseId: string,
  operationId: string,
): PredictionCostTreeRef {
  return { kind: 'predictionCostTree', result, caseId, operationId };
}

export function predictionKernelThroughputAnalysisRef(
  result: ResultRef & { readonly kind: 'prediction' },
  caseId: string,
  operationId: string,
  leafId: number,
): PredictionKernelThroughputAnalysisRef {
  return { kind: 'predictionKernelThroughputAnalysis', result, caseId, operationId, leafId };
}

export function predictionOptimalityKernelLadderRef(
  result: ResultRef & { readonly kind: 'prediction' },
  caseId: string,
  mode: 'unlocked' | 'batch_locked',
): PredictionOptimalityKernelLadderRef {
  return { kind: 'predictionOptimalityKernelLadder', result, caseId, mode };
}

export function predictionOptimalityWaterfallRef(
  result: ResultRef & { readonly kind: 'prediction' },
  caseId: string,
  mode: 'unlocked' | 'batch_locked',
): PredictionOptimalityWaterfallRef {
  return { kind: 'predictionOptimalityWaterfall', result, caseId, mode };
}

export function kernelTimeShareRef(result: ResultRef): KernelTimeShareRef {
  return { kind: 'kernelTimeShare', result };
}

export function workerKernelTimeShareRef(
  result: ResultRef,
  worker: WorkerCoordinate,
): WorkerKernelTimeShareRef {
  return { kind: 'workerKernelTimeShare', result, worker };
}

export function runSummaryRef(result: ResultRef): RunSummaryRef {
  return { kind: 'runSummary', result };
}

export function runLatencyRef(result: ResultRef): RunLatencyRef {
  return { kind: 'runLatency', result };
}

export function runConcurrencyRef(result: ResultRef): RunConcurrencyRef {
  return { kind: 'runConcurrency', result };
}

export function runDescriptorRef(result: RunResultRef): RunDescriptorRef {
  return { kind: 'runDescriptor', result };
}

/**
 * Canonicalize any deeper focus to the two segments that identify its worker.
 * A leaf and its parent operation therefore share one operation-sequence cache.
 */
export function operationsSeqRef(result: RunResultRef, path: readonly Segment[]): OperationsSeqRef {
  const pool = segmentOf(path, 'pool');
  const worker = segmentOf(path, 'worker');
  if (pool === null || worker === null) {
    throw new Error('An operation sequence requires pool and worker coordinates.');
  }
  return {
    seq: 'operations',
    result,
    at: [
      { at: 'pool', role: pool.role },
      { at: 'worker', id: worker.id },
    ],
  };
}

export function operationSequenceWorker(ref: OperationsSeqRef): WorkerCoordinate {
  return { poolTag: ref.at[0].role, workerId: ref.at[1].id };
}

/** Build the exact CostTree ref only from a complete operation path. */
export function workerCostTreeRef(
  result: RunResultRef,
  path: readonly Segment[],
): WorkerCostTreeRef {
  const pool = segmentOf(path, 'pool');
  const worker = segmentOf(path, 'worker');
  const operation = segmentOf(path, 'operation');
  if (pool === null || worker === null || operation === null) {
    throw new Error('A worker CostTree requires pool, worker, and operation coordinates.');
  }
  return {
    kind: 'workerCostTree',
    result,
    worker: { poolTag: pool.role, workerId: worker.id },
    operation: { iterId: operation.iter, batchId: operation.batch, operationId: operation.op },
  };
}

export function kernelThroughputAnalysisRef(
  result: RunResultRef,
  path: readonly Segment[],
): KernelThroughputAnalysisRef {
  const tree = workerCostTreeRef(result, path);
  const leaf = segmentOf(path, 'leaf');
  if (leaf === null) throw new Error('Kernel throughput analysis requires an exact leaf.');
  return {
    kind: 'kernelThroughputAnalysis',
    result,
    worker: tree.worker,
    operation: tree.operation,
    leafId: leaf.id,
  };
}

export function kernelInputDistributionRef(result: ResultRef): KernelInputDistributionRef {
  return { kind: 'kernelInputDistribution', result };
}

export function topologyRef(result: ResultRef): TopologyRef {
  return { kind: 'topology', result };
}

export function runModelRef(result: ResultRef): RunModelRef {
  return { kind: 'runModel', result };
}

export function runWorkloadRef(result: ResultRef): RunWorkloadRef {
  return { kind: 'runWorkload', result };
}

export function requestStateRef(result: ResultRef): RequestStateRef {
  return { kind: 'requestState', result };
}

export function requestStateSeriesRef(result: ResultRef): RequestStateSeriesRef {
  return { kind: 'requestStateSeries', result };
}

export function utilizationRef(result: ResultRef): UtilizationRef {
  return { kind: 'utilization', result };
}

export function utilizationSeriesRef(result: ResultRef): UtilizationSeriesRef {
  return { kind: 'utilizationSeries', result };
}

export function kvOccupancyRef(result: ResultRef): KvOccupancyRef {
  return { kind: 'kvOccupancy', result };
}

export function kvOccupancySeriesRef(result: ResultRef): KvOccupancySeriesRef {
  return { kind: 'kvOccupancySeries', result };
}

export function batchCompositionRef(result: ResultRef): BatchCompositionRef {
  return { kind: 'batchComposition', result };
}

export function batchSeriesRef(result: ResultRef): BatchSeriesRef {
  return { kind: 'batchSeries', result };
}

export function runThroughputRef(result: ResultRef): RunThroughputRef {
  return { kind: 'runThroughput', result };
}

export function throughputSeriesRef(result: ResultRef): ThroughputSeriesRef {
  return { kind: 'throughputSeries', result };
}

export function conservationRef(result: ResultRef): ConservationRef {
  return { kind: 'conservation', result };
}

export function runOptimalityRef(
  result: RunResultRef,
  mode: 'unlocked' | 'batch_locked',
): RunOptimalityRef {
  return { kind: 'runOptimality', result, mode };
}

export function iterationOptimalityKernelLadderRef(
  result: RunResultRef,
  worker: WorkerCoordinate,
  iterId: string,
  mode: 'unlocked' | 'batch_locked',
): IterationOptimalityKernelLadderRef {
  return { kind: 'iterationOptimalityKernelLadder', result, worker, iterId, mode };
}

export function iterationOptimalityWaterfallRef(
  result: RunResultRef,
  worker: WorkerCoordinate,
  iterId: string,
  mode: 'unlocked' | 'batch_locked',
): IterationOptimalityWaterfallRef {
  return { kind: 'iterationOptimalityWaterfall', result, worker, iterId, mode };
}

export function kernelProfileDescriptorRef(
  result: ResultRef & { readonly kind: 'kernelProfile' },
): KernelProfileDescriptorRef {
  const { revision: _unsupported, ...current } = result;
  return { kind: 'kernelProfileDescriptor', result: current };
}

export function kernelProfileCurveRef(
  result: ResultRef & { readonly kind: 'kernelProfile' },
): KernelProfileCurveRef {
  const { revision: _unsupported, ...current } = result;
  return { kind: 'kernelProfileCurve', result: current };
}

export function kernelMeasurementDescriptorRef(
  result: ResultRef & { readonly kind: 'kernelMeasurement' },
): KernelMeasurementDescriptorRef {
  const { revision: _unsupported, ...current } = result;
  return { kind: 'kernelMeasurementDescriptor', result: current };
}

export function kernelMeasurementSummaryRef(
  result: ResultRef & { readonly kind: 'kernelMeasurement' },
): KernelMeasurementSummaryRef {
  const { revision: _unsupported, ...current } = result;
  return { kind: 'kernelMeasurementSummary', result: current };
}

export function hardwareGpuRef(name: string): HardwareGpuRef {
  return { kind: 'hardwareGpu', name };
}

/** The value a ref reads to. Declared here so `useArtifact` infers it from the
 * ref alone and a panel never restates the type of what it asked for. */
export type ArtifactValue<R extends ArtifactRef> = R extends CatalogRef
  ? readonly CatalogEntry[]
  : R extends SweepAnalysisRef
    ? SweepAnalysis
    : R extends AlignmentDescriptorRef
      ? AlignmentDescriptor
      : R extends AlignmentIterationReportRef
        ? AlignmentIterationReport
        : R extends AlignmentIterationSeriesRef
          ? AlignmentIterationSeries
          : R extends AlignmentTimelineIndexRef
            ? AlignmentTimelineIndex
            : R extends AlignmentWorkloadSeriesRef
              ? AlignmentWorkloadSeries
              : R extends AlignmentE2eSeriesRef
                ? AlignmentE2eSeries
                : R extends AlignmentBreakdownRef
                  ? AlignmentBreakdown
                  : R extends AlignmentTimelineIterationRef
                    ? AlignmentTimelineIteration
                    : R extends AlignmentSequenceRef
                      ? AlignmentSequence
                      : R extends PredictionDescriptorRef
                        ? PredictionDescriptor
                        : R extends PredictionCasesRef
                          ? PredictionCasePage
                          : R extends PredictionCostTreeRef
                            ? PredictionCostTreeDetail
                            : R extends PredictionKernelThroughputAnalysisRef
                              ? PredictionKernelThroughputAnalysis
                              : R extends PredictionOptimalityKernelLadderRef
                                ? PredictionOptimalityKernelLadder
                                : R extends PredictionOptimalityWaterfallRef
                                  ? PredictionOptimalityWaterfall
                                  : R extends IterationOptimalityKernelLadderRef
                                    ? OptimalityKernelLadder
                                    : R extends IterationOptimalityWaterfallRef
                                      ? OptimalityIterationWaterfall
                                      : R extends WorkerCostTreeRef
                                        ? WorkerCostTreeDetail
                                        : R extends KernelThroughputAnalysisRef
                                          ? KernelThroughputAnalysis
                                          : R extends KernelTimeShareRef
                                            ? KernelTimeShare
                                            : R extends WorkerKernelTimeShareRef
                                              ? WorkerKernelComposition
                                              : R extends RunSummaryRef
                                                ? RunSummary
                                                : R extends RunLatencyRef
                                                  ? RunLatency
                                                  : R extends RunConcurrencyRef
                                                    ? RunConcurrency
                                                    : R extends RunDescriptorRef
                                                      ? RunDescriptor
                                                      : R extends KernelInputDistributionRef
                                                        ? KernelInputDistribution
                                                        : R extends TopologyRef
                                                          ? RunTopology
                                                          : R extends RunModelRef
                                                            ? RunModel
                                                            : R extends RunWorkloadRef
                                                              ? RunWorkload
                                                              : R extends RequestStateRef
                                                                ? RunRequestState
                                                                : R extends RequestStateSeriesRef
                                                                  ? RequestStateTimeline
                                                                  : R extends UtilizationRef
                                                                    ? RunUtilization
                                                                    : R extends UtilizationSeriesRef
                                                                      ? UtilizationTimeline
                                                                      : R extends KvOccupancyRef
                                                                        ? RunKvOccupancy
                                                                        : R extends KvOccupancySeriesRef
                                                                          ? KvOccupancyTimeline
                                                                          : R extends BatchCompositionRef
                                                                            ? RunBatchComposition
                                                                            : R extends BatchSeriesRef
                                                                              ? BatchTimeline
                                                                              : R extends RunThroughputRef
                                                                                ? RunThroughput
                                                                                : R extends ThroughputSeriesRef
                                                                                  ? ThroughputTimeline
                                                                                  : R extends ConservationRef
                                                                                    ? RunConservation
                                                                                    : R extends RunOptimalityRef
                                                                                      ? OptimalityDecodeResult
                                                                                      : R extends KernelProfileDescriptorRef
                                                                                        ? KernelProfileDescriptor
                                                                                        : R extends KernelProfileCurveRef
                                                                                          ? KernelProfileCurve
                                                                                          : R extends KernelMeasurementDescriptorRef
                                                                                            ? KernelMeasurementDescriptor
                                                                                            : R extends KernelMeasurementSummaryRef
                                                                                              ? KernelMeasurementSummary
                                                                                              : R extends HardwareGpuRef
                                                                                                ? HardwareGpu
                                                                                                : never;

/**
 * One population at one scope: how many requests were in it, on average and at
 * its worst.
 *
 * Two numbers rather than one because they answer different questions and a
 * reader who has only the mean cannot recover the other. A queue that averaged
 * two requests and peaked at 253 is a stall; one that averaged two and peaked
 * at three is a steady state.
 */
export interface RequestPopulation {
  /** The open category term from the run's stage vocabulary: `pending`,
   * `active`, `done`, or whatever else that run declared. Not an enum: the
   * vocabulary is the simulator's and a build that only knew today's three
   * would silently drop a fourth. */
  readonly category: string;
  readonly meanRequests: number;
  readonly peakRequests: number;
}

/** A pool's queue pressure, and the roster it is spread over. */
export interface RequestStatePool {
  readonly poolTag: string;
  /** The `run_meta` roster size, which is what the per-worker average divides
   * by — not the number of workers that happened to see traffic. */
  readonly workers: number;
  readonly meanTotalPending: number;
  readonly peakTotalPending: number;
  readonly meanPendingPerWorker: number;
}

/** One worker's queue, and its share of every population the run tracks. */
export interface RequestStateWorker {
  readonly poolTag: string;
  readonly workerId: string;
  readonly meanPending: number;
  readonly peakPending: number;
  readonly categories: readonly RequestPopulation[];
}

/**
 * Where a run's requests were waiting.
 *
 * The window is carried because the means are over it: "2.3 requests pending"
 * is a time-weighted average across `spanMs`, and a reader comparing two runs
 * of different lengths is comparing two different averages.
 */
export interface RunRequestState {
  readonly cluster: readonly RequestPopulation[];
  readonly pools: readonly RequestStatePool[];
  readonly workers: readonly RequestStateWorker[];
  readonly window: {
    readonly spanMs: number;
    readonly bins: number;
    readonly binWidthMs: number;
  };
  /** Requests with a stage history at all. The populations describe these. */
  readonly requestsTracked: number;
  readonly transitions: number;
  readonly definitions: Readonly<Record<string, string>>;
}

export interface RequestStateTimelineCategory {
  readonly category: string;
  readonly values: readonly number[];
}

export interface RequestStateTimelineWorker {
  readonly worker: WorkerCoordinate;
  readonly pending: readonly number[];
  readonly series: readonly RequestStateTimelineCategory[];
}

export interface RequestStateTimelinePool {
  readonly pool: number;
  readonly poolTag: string;
  readonly workerCount: number;
  readonly totalPending: readonly number[];
  readonly averagePending: readonly number[];
  readonly workers: readonly RequestStateTimelineWorker[];
}

export interface RequestStateTimeline {
  readonly tStartMs: readonly number[];
  readonly tEndMs: readonly number[];
  readonly clusterSeries: readonly RequestStateTimelineCategory[];
  readonly pools: readonly RequestStateTimelinePool[];
  readonly sourceLogDir: string;
  readonly deployment: string | null;
  readonly requestsTracked: number | null;
  readonly transitions: number | null;
  readonly window: {
    readonly spanMs: number;
    readonly bins: number;
    readonly binWidthMs: number;
  } | null;
  readonly aggregation: string | null;
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * One scope's share of the wall clock spent computing.
 *
 * A fraction, not a percentage, and not clamped to 1: the Analyzer publishes
 * values above 1 rather than hiding overlapping busy intervals behind a plot
 * that looks fine. See `schema/utilization.ts`.
 */
export interface UtilizationPool {
  readonly poolTag: string;
  /** The `run_meta` roster this pool's fraction divides by — including workers
   * that saw no traffic, which is what makes an idle member visible. */
  readonly workers: number;
  readonly busyFraction: number;
}

export interface UtilizationWorker {
  readonly poolTag: string;
  readonly workerId: string;
  readonly busyFraction: number;
}

/**
 * How busy a run's hardware was, at all three scopes.
 *
 * The window is carried for the same reason as the request state's: every
 * fraction here is busy time over the run's own span, so two runs of different
 * lengths are two different denominators.
 */
export interface RunUtilization {
  readonly overall: number;
  readonly pools: readonly UtilizationPool[];
  readonly workers: readonly UtilizationWorker[];
  /** The GPU model the run recorded, when it recorded one. */
  readonly gpu: string | undefined;
  readonly window: {
    readonly spanMs: number;
    readonly bins: number;
    readonly binWidthMs: number;
  };
  readonly definitions: Readonly<Record<string, string>>;
}

export interface UtilizationTimeline {
  readonly tMs: readonly number[];
  readonly series: readonly {
    readonly key: string;
    readonly label: string;
    readonly poolTag: string;
    readonly util: readonly number[];
  }[];
  readonly workerSeries: readonly {
    readonly key: string;
    readonly label: string;
    readonly worker: WorkerCoordinate;
    readonly util: readonly number[];
  }[];
  readonly sourceLogDir: string;
  readonly gpuName: string | null;
  readonly unit: string;
  readonly workerUnit: string | null;
  readonly averages: Readonly<Record<string, number>>;
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * One token level of a KV pool, at its worst moment.
 *
 * Published twice because the shards of a pool are independent caches of equal
 * size: `mean` is the peak of what they held on average, `max` is the peak of
 * the worst one. The gap between them is shard imbalance, and it is the whole
 * reason both are here — a pool averaging 60% with one shard at 99% is out of
 * memory in the only place that matters.
 *
 * `fraction` is `tokens / capacity`, or `null` when this pool declared no
 * capacity: a token count with nothing to be a fraction of is still a number,
 * and a percentage invented against an assumed capacity is not.
 */
export interface KvPeak {
  readonly meanTokens: number;
  readonly meanFraction: number | null;
  readonly maxTokens: number;
  readonly maxFraction: number | null;
}

/**
 * What the admission gate expected the requests it let in to need.
 *
 * Deliberately not bounded by capacity: exceeding it is the signal that the
 * admitted horizon outruns the pool, and a value clamped to 100% would say
 * "full" for both a pool that is full and a pool that is about to preempt.
 *
 * No `maxTokens`. The analysis publishes the worst shard's projection only as a
 * fraction, and it is carried as absent rather than recomputed from the
 * fraction and the capacity — the arithmetic would be exact, and it would still
 * be this build stating a figure the analysis did not.
 */
export interface KvProjection {
  readonly meanTokens: number;
  readonly meanFraction: number | null;
  readonly maxFraction: number | null;
}

/** KV reserved for admitted requests but not yet resident. Worst shard only,
 * which is what the analysis publishes. */
export interface KvReservation {
  readonly maxTokens: number;
  readonly maxFraction: number | null;
}

/** One KV pool — a `(pool_tag, group_id)` pair — and how full it ran. */
export interface KvSeries {
  readonly poolTag: string;
  /** The DP group inside that pool. Not addressable: the location grammar has
   * pools and workers, so a pool with several groups shows all of them. */
  readonly groupId: number;
  /** What to call it on screen; the group is only named when there are two. */
  readonly label: string;
  readonly capacityTokens: number | null;
  readonly workers: number;
  /** What was actually resident. */
  readonly active: KvPeak;
  /**
   * The prefix-cache component of `active`, or `null` when the run did not
   * record one.
   *
   * `null` rather than a level of zeros. The simulator gained this column after
   * the fact, and older runs are served with it zero-filled beside a flag
   * saying so — which is exactly what a run that cached no prefixes reports.
   * Collapsing the two would let a panel state a measurement that was never
   * made.
   */
  readonly retainedPrefix: KvPeak | null;
  readonly projected: KvProjection;
  readonly promised: KvReservation;
  /**
   * Mean occupancy across the bins in which this pool held anything.
   *
   * Not a time-weighted mean over the run: the analysis divides by the number
   * of non-empty bins, so a pool that was busy for a tenth of the run reports
   * what it held *while busy*. It is therefore not comparable with the
   * utilization subject's average, and the panel says what it is over.
   */
  readonly meanActiveFraction: number | null;
}

export interface RunKvOccupancy {
  readonly series: readonly KvSeries[];
  readonly window: {
    readonly spanMs: number;
    readonly bins: number;
    readonly binWidthMs: number;
  };
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * The Analyzer's complete KV time series, retained for visual parity with the
 * existing occupancy chart. Values remain raw token counts; drawing code may
 * derive fractions from the corresponding capacity without changing the data.
 */
export interface KvOccupancyTimeline {
  readonly tMs: readonly number[];
  readonly series: readonly {
    readonly key: string;
    readonly label: string;
    readonly poolTag: string;
    readonly groupId: number;
    readonly capacity: number | null;
    readonly workerCount: number;
    readonly active: KvTimelineBand;
    readonly retainedPrefix: KvTimelineBand | null;
    readonly projected: KvTimelineBand;
    readonly promised: KvTimelineBand;
  }[];
  readonly workerSeries: readonly {
    readonly key: string;
    readonly label: string;
    readonly worker: WorkerCoordinate;
    /** KV group inside the worker's pool; worker ids repeat across groups. */
    readonly groupId: number;
    readonly capacity: number | null;
    readonly active: readonly number[];
    readonly retainedPrefix: readonly number[] | null;
    readonly projected: readonly number[];
    readonly promised: readonly number[];
  }[];
  readonly sourceLogDir: string;
  readonly unit: string;
  readonly hasCapacity: boolean;
  readonly hasRetainedPrefixBreakdown: boolean;
  readonly definitions: Readonly<Record<string, string>>;
}

/** Across-shard values for every time bin. */
export interface KvTimelineBand {
  readonly mean: readonly number[];
  readonly min: readonly number[];
  readonly max: readonly number[];
}

/**
 * One count's distribution over a scope's sampled invocations.
 *
 * The percentiles rather than the mean are the point. These distributions are
 * extremely skewed — a live run reports a mean of 6.98 tokens with a median of
 * 1 and a maximum of 1025 — because a handful of prefill invocations carry a
 * thousand tokens each and everything else carries one. The mean of that is a
 * batch size which never occurred.
 */
export interface BatchMetric {
  /** How many invocations this distribution is over. Not the number there
   * were: see `BatchScope.invocations`. */
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
}

/**
 * One pool, or one worker inside a pool, and what its invocations carried.
 *
 * Pools are not comparable with each other by construction and the panel says
 * so: in a disaggregated deployment the attention workers are data-parallel
 * shards, so each row is one shard's local slice, while the FFN pool is the
 * aggregator and each of its rows is the summed batch. Ranking one against the
 * other would be reading a difference in what is being counted as a difference
 * in how much work there was.
 */
export interface BatchScope {
  readonly poolTag: string;
  /** `null` for a pool. Numeric at the source, carried as a string because it
   * becomes a path segment. */
  readonly workerId: string | null;
  /** How many invocations this scope ran. Exact — a `COUNT(*)` at the source,
   * not the sample below. */
  readonly invocations: number;
  /** How many of them the distributions are over. The analysis keeps a regular
   * stride through the run's iterations (`iter_id % stride == 0`), so this is an
   * even slice of the run's iterations and not of its clock: iterations differ
   * in length, and it is not a random subset either. */
  readonly sampled: number;
  readonly batchTokens: BatchMetric | null;
  /**
   * What the batch was made of, where the pool records it.
   *
   * Null together, and for two different reasons the panel has to tell apart.
   * `batchTokens` null as well means nothing here was sampled. `batchTokens`
   * present with these null means the pool logs its batch size and not its
   * composition — an FFN pool writes zeros into these columns, and a zero read
   * as a measurement says the batch was made of nothing.
   */
  readonly prefillTokens: BatchMetric | null;
  readonly decodeRequests: BatchMetric | null;
  /**
   * Mean draft rows per invocation: rows that were neither prefill nor the one
   * row each decode request submits.
   *
   * Zero for an ordinary engine. Under speculative decoding one decode request
   * submits `draft_tokens + 1` query rows and the request count counts one, so
   * the residue is `draft_tokens` per request — the speculation, not the whole
   * verify batch, which is this plus the requests. `null` when there is no
   * sample, and when the composition was never recorded.
   */
  readonly draftRows: number | null;
}

export interface RunBatchComposition {
  readonly pools: readonly BatchScope[];
  readonly workers: readonly BatchScope[];
  /**
   * Every invocation the run logged, across all pools.
   *
   * Exact, and counted over every pool that ran — including pools the sampling
   * stride stepped over entirely, which are counted here and absent from
   * `pools`. The projection derives that gap from these two, at both depths, so
   * it is not carried a second time here.
   */
  readonly invocations: number;
  readonly definitions: Readonly<Record<string, string>>;
}

export type BatchTimelineMetricKey = 'batch_tokens' | 'prefill_tokens' | 'decode_request_count';

export interface BatchTimelineSeries {
  readonly key: string;
  readonly label: string;
  readonly values: readonly number[];
}

export interface BatchTimelineScope {
  readonly poolTag: string;
  readonly workerId: string | null;
  readonly invocations: number;
  readonly plottedPoints: number;
  readonly timeMs: readonly number[];
  readonly series: readonly BatchTimelineSeries[];
  readonly averages: Readonly<Record<string, number>>;
}

export interface BatchTimeline {
  readonly pools: readonly BatchTimelineScope[];
  readonly workers: readonly BatchTimelineScope[];
  readonly sourceLogDir: string;
  readonly invocations: number;
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * One measured interval of the run, and the rate it served at.
 *
 * An interval between two consecutive `request_state` snapshots. The rates are
 * the cumulative token columns differenced and divided by the interval, so a
 * segment is a measurement and not a sample: every token the run processed
 * falls in exactly one of them.
 */
export interface ThroughputSegment {
  readonly startMs: number;
  readonly endMs: number;
  /** Context tokens processed per second over this interval. */
  readonly prefillPerSecond: number;
  /** Output tokens generated per second over this interval. */
  readonly decodePerSecond: number;
  /** The two above, added. See `RunThroughput` for why that sum is stated
   * rather than led with. */
  readonly totalPerSecond: number;
}

/** A token rate over the whole logged window, and what it came from. */
export interface ThroughputRate {
  /** Tokens over the window. Exact: a difference of cumulative columns. */
  readonly tokens: number;
  readonly perSecond: number;
  /** The same rate divided by the GPU count. Equal to `perSecond` when the
   * count was assumed — see `RunThroughput.gpuName`. */
  readonly perGpu: number;
}

/**
 * What the run delivered, and whether it delivered it evenly.
 *
 * `total` is `prefill` plus `decode`, which is the figure the overview leads
 * with. The sum is arithmetic and not a measurement of comparable things: a
 * prefill token is one token of context put through a batched matmul, a decode
 * token is one token generated a step at a time, and a run at 1,024 prefill
 * plus 256 decode is doing different work from one at 256 plus 1,024 with the
 * same total. So all three are published and the panel prints the parts.
 */
export interface RunThroughput {
  readonly total: ThroughputRate;
  readonly prefill: ThroughputRate;
  readonly decode: ThroughputRate;
  /** Every measured interval, in time order and contiguous. */
  readonly segments: readonly ThroughputSegment[];
  /** How wide the logged window was. The rates above are over this. */
  readonly spanSeconds: number;
  /** How many GPUs the rates were divided by. At least 1. */
  readonly gpus: number;
  /**
   * The name of the GPU the report carries, or `null` when it carries none.
   *
   * It says nothing about `gpus` above. `read_run_meta` reads the count from
   * `num_gpus` and the name from `gpus[0].name`, and either can be absent
   * without the other: a sidecar of `{"num_gpus": 4}` yields four GPUs and no
   * name, and every per-GPU figure really was divided by four. A missing
   * sidecar lands here as one GPU and no name, and nothing in the document
   * separates that from a sidecar that counted one. So `null` means the name
   * is unavailable — not that the count was assumed.
   */
  readonly gpuName: string | null;
  /**
   * The coarse trend view the producer also publishes: the same tokens
   * re-aggregated into at most ten equal-width bins.
   *
   * Carried as a count, not as the bins. The bins are exact only where an edge
   * lands on a snapshot tick — elsewhere the cumulative is interpolated — so
   * they are a smoothing of the segments above and not a second measurement,
   * and this build reads the segments.
   */
  readonly bins: number;
  readonly definitions: Readonly<Record<string, string>>;
}

export interface ThroughputTimelineSeries {
  readonly key: string;
  readonly label: string;
  readonly perGpu: readonly number[];
}

export interface ThroughputTimelineView {
  readonly startMs: readonly number[];
  readonly endMs: readonly number[];
  readonly series: readonly ThroughputTimelineSeries[];
}

export interface ThroughputTimeline {
  readonly fine: ThroughputTimelineView;
  readonly coarse: ThroughputTimelineView | null;
  readonly sourceLogDir: string;
  readonly gpuName: string | null;
  readonly gpus: number;
  readonly unit: string;
  readonly averagesPerGpu: Readonly<Record<string, number>>;
  readonly definitions: Readonly<Record<string, string>>;
}

/** What a check concluded: the producer's own verdict, not a recomputation. */
export type ConservationStatus = 'ok' | 'warn' | 'fail';

/**
 * One identity, restated two ways.
 *
 * `expected` is what the workload implies and `actual` is what the log holds.
 * The gap between them is `delta`; whether that gap matters is `status`, and
 * the two are *not* the same question — see `deltaPercent`.
 */
export interface ConservationCheck {
  readonly name: string;
  /** The producer's own sentence, which names both sides of the identity. */
  readonly description: string;
  readonly expected: number;
  readonly actual: number;
  readonly delta: number;
  /**
   * The gap as a percentage of `expected`, or `null` when there is no
   * percentage to take.
   *
   * `null` means `expected` was zero and `actual` was not — a check of the form
   * "there should be none of this" that found some. That is the most serious
   * result a check can have and the one with no number, so a panel that ranked
   * by this figure would sort the worst case to the bottom or drop it.
   */
  readonly deltaPercent: number | null;
  readonly status: ConservationStatus;
  /**
   * How much of a positive gap the producer already accounts for.
   *
   * A run stopped by the clock can leave one decode token partway through the
   * layer pipeline, and that much surplus is expected rather than wrong. Only
   * published where it applies, and never applied to a shortfall.
   */
  readonly allowance: number | null;
  /** The gap the allowance does not cover — what `status` was decided on. */
  readonly unexplained: number;
}

export interface RunConservation {
  readonly checks: readonly ConservationCheck[];
  /** The producer's summary. Cross-checked against the rows, not trusted. */
  readonly allOk: boolean;
  /** Below this percentage a gap is `ok`; below `warnPercent` it is `warn`. */
  readonly tolerancePercent: number;
  readonly warnPercent: number;
  /** `unified` or `afd`: which family of formulas the expectations came from. */
  readonly deployment: string;
  readonly requests: number;
  readonly iterations: number;
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * One row of the results catalog, normalized across the six kinds.
 *
 * Declared here rather than in `schema/catalog.ts` so `ArtifactValue` can name
 * it without the ref module depending on a schema module.
 */
export interface CatalogEntry {
  readonly kind: ResultKind;
  readonly id: ResultId;
  readonly workspace: string;
  readonly displayName: string;
  readonly status: CatalogStatus;
  /** RFC 3339, as served. Kept as a string: the only thing the catalog does
   * with it is sort and display, and parsing it to a `Date` here would lose the
   * server's offset. */
  readonly updatedAt: string;
  /** Sweep-only header metadata, retained when the catalog publishes it. */
  readonly numRuns?: number;
  readonly deployments?: readonly string[];
  readonly traces?: readonly string[];
  readonly axes?: readonly string[];
  /** Page 0 metadata retained from the catalog wire so the migrated result
   * directory can reproduce the existing subtitles and tags exactly. */
  readonly caseCount?: number;
  readonly gpuName?: string;
  readonly backend?: string;
  readonly selector?: string;
  readonly kernelKind?: string;
  readonly table?: string;
  readonly analysisHalves?: readonly { name: string; status: string }[];
}

/**
 * `partial` is real and distinct: an alignment with a finished kernel half and
 * an unfinished end-to-end half is browsable, and filing it as unfinished hides
 * a result the user can already read.
 *
 * `unknown` exists because three of the six kinds serve a free-form status
 * string. Mapping an unrecognized word onto `pending` would state something the
 * server did not.
 */
export type CatalogStatus = 'ready' | 'partial' | 'pending' | 'not_started' | 'failed' | 'unknown';

/** One manifest position's contribution to a scope's critical-path kernel time. */
export interface KernelSegment {
  readonly position: string;
  readonly kind: string;
  readonly kernelTimeMs: number;
  readonly sharePct: number;
}

export interface KernelComposition {
  readonly kernelTimeMs: number;
  readonly segments: readonly KernelSegment[];
}

export interface PoolKernelComposition extends KernelComposition {
  readonly poolTag: string;
  readonly numWorkers: number;
}

/**
 * How exact a scope's numbers are.
 *
 * Kernel time is always exact; the *mixture* across positions may come from a
 * bounded replay sample. Keeping both counts means a panel can say which it is
 * showing instead of implying precision it does not have.
 */
export interface KernelSampling {
  readonly rawRows: number;
  readonly sampledRows: number;
  readonly stride: number;
}

/** A worker as the cluster read knows it: identity and totals, no composition. */
export interface WorkerKernelIndexEntry {
  readonly worker: WorkerCoordinate;
  readonly kernelTimeMs: number;
  readonly sampling: KernelSampling;
}

export interface WorkerKernelComposition extends KernelComposition {
  readonly worker: WorkerCoordinate;
  readonly sampling: KernelSampling;
}

export interface KernelPosition {
  readonly name: string;
  readonly kind: string;
  readonly overallSharePct: number;
}

export interface KernelTimeShare {
  readonly overall: KernelComposition;
  readonly pools: readonly PoolKernelComposition[];
  readonly workers: readonly WorkerKernelIndexEntry[];
  readonly positions: readonly KernelPosition[];
  /** Run-level replay accounting, and the method that produced it. */
  readonly sampling: KernelSampling & { readonly exact: boolean; readonly method: string };
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * The simulator's report of a finished run.
 *
 * Field for field what the simulator writes, renamed but not reinterpreted:
 * every number here is served, and the overview's job is to choose which of
 * them a reader sees first.
 */
export interface RunSummary {
  /** Why the run stopped — `DrainComplete` for one that finished its workload. */
  readonly cause: string;
  readonly totalTokensPerSecond: number;
  readonly totalTokensPerSecondPerGpu: number;
  readonly prefillTokensPerSecond: number;
  readonly decodeTokensPerSecond: number;
  readonly completedRequestsPerSecond: number;
  readonly gpus: number;
  readonly requestsFinished: number;
  readonly requestsTotal: number;
  readonly prefillTokens: number;
  readonly decodeTokens: number;
  readonly totalTokens: number;
  /** Simulated milliseconds, and the seconds of wall clock they took. */
  readonly simulatedMs: number;
  readonly wallSeconds: number;
  /** Simulated time over wall time: how much faster than real this ran. */
  readonly realtimeFactor: number;
}

/** One latency distribution, including the empirical CDF drawn by the run page. */
export interface LatencyMarkers {
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
}

export interface LatencySeries {
  /** The analyzer's key: `ttft`, `tpot`, `e2e`. Kept as served. */
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  /** How many requests the distribution is over. */
  readonly count: number;
  /** Null only when this metric has no finite completed-request samples. */
  readonly markers: LatencyMarkers | null;
  /** Parallel CDF columns: latency on x and cumulative request percentage on y. */
  readonly x: readonly number[];
  readonly yPct: readonly number[];
}

export interface RunLatency {
  readonly series: readonly LatencySeries[];
  /** What each series measures, in the analyzer's own words. */
  readonly definitions: Readonly<Record<string, string>>;
}

/** Analyzer schema-1 request concurrency, including its complete provenance. */
export interface RunConcurrency {
  readonly tMs: readonly number[];
  readonly active: readonly number[];
  readonly peak: number;
  readonly sourceLogDir: string;
  readonly requestCount: number;
  readonly spanMs: number;
  readonly bins: number;
  readonly maxPoints: 512;
  readonly aggregation: 'equal-width time-weighted mean';
  readonly definitions: Readonly<{
    scope: string;
    active: string;
    tMs: string;
    peak: string;
    binning: string;
  }>;
}

export type Deployment = 'unified' | 'pd' | 'afd';
export type LifecycleStageStatus = 'not_started' | 'pending' | 'complete' | 'failed';
export type ArtifactView = 'report' | 'payload';
export type ArtifactViews = readonly [ArtifactView, ...ArtifactView[]];

export interface ArtifactCapability {
  readonly views: ArtifactViews;
  readonly mediaType?: string;
  readonly schemaVersion?: number;
  readonly byteLength?: number;
  readonly sha256?: string;
}

export type PendingArtifact = { readonly status: 'pending'; readonly reason?: string };
export type UnavailableArtifact = {
  readonly status: 'unavailable';
  readonly reason: string;
  readonly code?: string;
};
export type NotGeneratedArtifact = { readonly status: 'not_generated'; readonly reason?: string };
export type FailedArtifact = {
  readonly status: 'failed';
  readonly code: string;
  readonly reason: string;
};
export type ReadySubjectArtifact = {
  readonly status: 'ready';
  readonly schemaVersion: number;
  readonly views: ArtifactViews;
  readonly variants?: Readonly<Record<string, { readonly views: ArtifactViews }>>;
};
export type SubjectArtifact =
  | ReadySubjectArtifact
  | PendingArtifact
  | UnavailableArtifact
  | NotGeneratedArtifact
  | FailedArtifact;
export type DetailArtifact =
  | { readonly status: 'ready'; readonly schemaVersion: number; readonly views: ArtifactViews }
  | PendingArtifact
  | UnavailableArtifact
  | NotGeneratedArtifact
  | FailedArtifact;

export interface TraceDownload {
  readonly href: string;
  readonly mediaType?: string;
  readonly byteLength?: number;
  readonly sha256?: string;
}
export type TraceResource =
  | { readonly status: 'ready'; readonly artifact: TraceDownload }
  | PendingArtifact
  | UnavailableArtifact
  | NotGeneratedArtifact
  | FailedArtifact;

export type ArtifactProvenance =
  | {
      readonly source: 'analyzer';
      readonly synthetic: false;
      readonly generatedAt?: string;
      readonly generatorVersion?: string;
    }
  | {
      readonly source: 'fixture';
      readonly synthetic: boolean;
      readonly fixtureId: string;
      readonly sourceRun?: string;
      readonly generatedAt?: string;
    };

export type DescriptorSubjectName =
  | 'slo'
  | 'throughput'
  | 'utilization'
  | 'kv'
  | 'concurrency'
  | 'backpressure'
  | 'requestState'
  | 'batch'
  | 'kernelThroughput'
  | 'conservation'
  | 'kernelInputDistribution'
  | 'kernelTimeShare'
  | 'optimality';

/** Full analyzer-v1 run capability manifest. */
export interface RunDescriptor {
  readonly protocolVersion: 1;
  readonly workspaceId: string;
  readonly runId: string;
  readonly kind: 'simulation';
  readonly displayName?: string;
  readonly modelName?: string;
  readonly deployment: Deployment;
  readonly lifecycle: {
    readonly simulation: LifecycleStageStatus;
    readonly analysis: LifecycleStageStatus;
  };
  readonly summary: ArtifactCapability;
  readonly model?: ArtifactCapability;
  readonly workload?: ArtifactCapability;
  readonly topology?: ArtifactCapability;
  readonly workers?: readonly WorkerCoordinate[];
  readonly subjects: Partial<Record<DescriptorSubjectName, SubjectArtifact>>;
  readonly details: Readonly<Record<string, DetailArtifact>>;
  readonly traces: Readonly<Record<string, TraceResource>>;
  readonly analysis?: {
    readonly revision: string;
    readonly generatedAt: string;
    readonly generatorVersion: string;
  };
  readonly provenance?: ArtifactProvenance;
}

export type KernelInputProjection = 'categorical' | 'feature_1d' | 'raw_2d' | 'pca';

export interface KernelBackendSelection {
  readonly backendIndex: number;
  readonly backendName: string;
  readonly count: number;
  readonly ratio: number;
}

export interface KernelInputPoint {
  readonly x: number;
  readonly y: number;
  readonly backendIndex: number;
  readonly backendName: string;
  /** Number of sampled slots represented by this deduplicated point. */
  readonly count: number;
}

/** One distribution keyed by the CostTree leaf's exact manifest position name. */
export interface KernelInputPosition {
  readonly name: string;
  readonly kind: string;
  readonly candidateBackends: readonly string[];
  readonly selection: readonly KernelBackendSelection[];
  readonly projection: KernelInputProjection;
  readonly axisLabels: readonly [string, string];
  readonly explainedVariance: readonly [number, number] | null;
  readonly points: readonly KernelInputPoint[];
}

/** Complete schema-1 kernel-input distribution payload and producer metadata. */
export interface KernelInputDistribution {
  readonly positions: readonly KernelInputPosition[];
  readonly sourceLogDir: string;
  readonly sampling: {
    readonly stride: number;
    readonly sampledRows: number;
    readonly skippedNotExecutedSlots: number;
    readonly skippedEmptyInputSlots: number;
    readonly maxPointsPerPosition: number;
  };
  readonly positionCounts: {
    readonly plotted: number;
    readonly multiBackend: number;
    readonly manifest: number;
    readonly omitted: number;
    readonly withoutCandidates: number;
  };
  readonly definitions: Readonly<Record<string, string>>;
}

/**
 * A run's shape: which pools it had, and which workers were in them.
 *
 * Flattened from the two documents the analyzer serves — the simulator's own
 * `params` and the `run_meta` written at run time — and cross-checked against
 * each other, because they are two independent statements of the same fact and
 * a reader has no way to notice when they disagree.
 */
export interface RunTopology {
  readonly pools: readonly TopologyPool[];
  /** Every GPU the run placed, counted once. */
  readonly gpus: number;
  /** The simulator's deployment family; it determines the overview headline. */
  readonly deployment: 'unified' | 'pd' | 'afd';
}

export interface TopologyPool {
  /**
   * The pool's tag, which is both its name on screen and its path segment.
   *
   * One string, not two, because a display name that differed from the address
   * would leave a reader unable to tell which pool a URL names.
   */
  readonly tag: string;
  readonly placement: string;
  readonly group: TopologyGroup;
}

/**
 * The one configuration every worker in a pool shares.
 *
 * Singular because the simulator rejects a heterogeneous pool at build time and
 * `run_meta` carries no group identity — so a pool declaring two groups is a
 * payload nothing could assign workers to, and is refused rather than guessed
 * at by array position.
 */
export interface TopologyGroup {
  /** The GPU model, as the run recorded it: "NVIDIA H200". */
  readonly gpu: string;
  readonly archType: string;
  readonly workerType: string;
  readonly replicas: number;
  readonly gpusPerReplica: number;
  /**
   * The architecture parameters the run declared, as declared.
   *
   * Passed through rather than narrowed, for the same reason as
   * `RunModel.config`: the vocabulary is per-architecture — one family spells
   * tensor parallelism `tp_size`, another `attn_tp`, a dense model declares
   * neither — and a fixed set of fields here would silently drop whatever the
   * next family calls it. Which of these are worth showing is a display
   * judgement, and it is made in the panel where a test can argue with it.
   */
  readonly params: Readonly<Record<string, unknown>>;
  readonly workers: readonly TopologyWorker[];
}

export interface TopologyWorker {
  /** The worker's id within its pool, and its path segment. */
  readonly id: string;
  readonly gpus: readonly number[];
}

/**
 * The model the run served, as its own config file recorded it.
 *
 * `config` is kept as the raw map rather than a decoded model: it is another
 * project's file, its keys differ per architecture, and every reader here wants
 * two or three of them by name. Narrowing it would mean maintaining a union of
 * every architecture the simulator can load.
 */
export interface RunModel {
  readonly sourcePath: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly parameters: ModelParameterCounts | undefined;
}

export interface ModelParameterCounts {
  readonly total: number;
  readonly active: number;
}

/** The Analyzer's bounded summary of the configured trace. */
export interface RunWorkload {
  readonly sourcePaths: readonly string[];
  readonly requestCount: number;
  readonly averageInputTokens: number;
  readonly averageOutputTokens: number;
  readonly arrivalBasis: 'effective_open_loop' | 'effective_trace_timed' | 'source_trace';
  readonly requestRate: number;
  readonly tokenLengths: readonly number[];
  readonly inputDensity: readonly number[];
  readonly outputDensity: readonly number[];
  readonly arrivalSeconds: readonly number[];
  readonly arrivals: readonly number[];
  readonly arrivalTrend: readonly number[];
  readonly peakToMean: number;
}
