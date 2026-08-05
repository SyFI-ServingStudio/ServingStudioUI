/**
 * Alignment bundles: a measured vLLM capture set beside the VibeSim prediction
 * of the same shapes.
 *
 * A bundle is a first-class Analyzer resource like a run or a timing
 * prediction, and it carries four subjects across two independent analysis
 * halves — `iteration` and `timeline` from the kernel half, `workload` and
 * `e2e` from the end-to-end half. Either half may be missing, so the descriptor
 * reports each separately rather than declaring the bundle ready.
 *
 * Two of those subjects are indexes: their payload holds one summary row per
 * iteration plus byte ranges into a sibling shard, and one iteration's full
 * detail is fetched on demand. A capture is 2,000+ iterations and hundreds of
 * megabytes of detail; the index is what makes it browsable.
 *
 * Field names follow the analyzer's own vocabulary in camelCase. The one
 * deliberate exception is `definitions`, whose KEYS are analyzer terms
 * (`measured_gpu_cycle_ms`, `host.nvtx`) — the page renders those strings
 * verbatim rather than writing its own account of what a number means.
 */

export const ALIGNMENT_SUBJECTS = ['iteration', 'timeline', 'workload', 'e2e'] as const;

export type AlignmentSubjectName = (typeof ALIGNMENT_SUBJECTS)[number];

/** Analyzer-supplied prose, keyed by the field it explains. Rendered verbatim. */
export type AlignmentDefinitions = Readonly<Record<string, string>>;

export interface AlignmentSubjectResource {
  readonly status: 'ready' | 'not_generated';
  /** True when this subject also serves per-iteration detail by byte range. */
  readonly hasIterationDetail: boolean;
}

export interface AlignmentDescriptor {
  readonly alignmentId: string;
  readonly displayName: string;
  readonly lifecycle: {
    readonly kernelAnalysis: 'not_started' | 'pending' | 'complete';
    readonly e2eAnalysis: 'not_started' | 'pending' | 'complete';
  };
  readonly subjects: Readonly<Record<AlignmentSubjectName, AlignmentSubjectResource>>;
}

/** The analyzer's standard six-number summary of a distribution. `min` is
 * absent on absolute-error blocks, where it would restate the p0 of a
 * non-negative quantity. */
export interface AlignmentDistribution {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
  readonly min: number | null;
}

// ---- iteration subject ----------------------------------------------------

/** One paired iteration.
 *
 * `*GpuCycle*` fields are the duty-corrected view: measured is
 * boundary-to-boundary wall time, simulated is kernel time scaled by the
 * pooled multiplier. The unsuffixed fields are pure kernel time.
 *
 * Every cycle field is nullable because a cycle is measured to the NEXT
 * iteration's boundary, and the last iteration in a capture has no next one.
 * Substituting a zero there would report the final iteration as instantaneous. */
export interface AlignmentPairedIteration {
  readonly iterationId: number;
  readonly caseIndex: number;
  readonly iterationType: string;
  readonly stage: string;
  readonly measuredMs: number;
  readonly simulatedMs: number;
  readonly deltaMs: number;
  readonly relativeDiffPct: number;
  readonly cumulativeDeltaMs: number;
  readonly cumulativeRelativeDiffPct: number;
  readonly measuredBusyUnionMs: number;
  readonly measuredGpuCycleMs: number | null;
  readonly simulatedGpuCycleMs: number | null;
  readonly gpuCycleDeltaMs: number | null;
  readonly gpuCycleRelativeDiffPct: number | null;
  readonly gpuCycleCumulativeDeltaMs: number | null;
  readonly gpuCycleCumulativeRelativeDiffPct: number | null;
}

/** A kernel position in a labelled program, with what it cost across the run.
 * `rowId` is `sequence_id:expanded_ordinal` — the join key back to a program
 * position, which is why the same kernel name may appear many times. */
export interface AlignmentKernelRow {
  readonly rowId: string;
  readonly name: string;
  readonly category: string;
  readonly phase: string;
  readonly operation: string | null;
  readonly totalMs: number;
  readonly meanCallUs: number;
  readonly calls: number;
  readonly callsPerIteration: number;
  readonly replicaCalls: number;
  readonly replicaCallsPerIteration: number;
  readonly rankLaunches: number;
  readonly iterations: number;
  readonly deviceIds: readonly number[];
}

export interface AlignmentMappedOperation {
  readonly operation: string;
  readonly role: string;
  readonly type: string;
  readonly simulatedSlots: readonly string[];
  readonly measuredRows: number;
}

export interface AlignmentMappingCoverage {
  readonly measuredDurationFraction: number;
  readonly measuredMappedMs: number;
  readonly measuredTotalKernelMs: number;
  readonly simulatedWorkloadFraction: number;
  readonly simulatedMappedMs: number;
  readonly simulatedTotalLeafWorkloadMs: number;
}

export interface AlignmentUnmappedKernel {
  readonly rowId: string;
  readonly name: string;
  readonly phase: string;
  readonly totalMs: number;
  readonly calls: number;
  readonly deviceIds: readonly number[];
}

export interface AlignmentUnmappedSlot {
  readonly slot: string;
  readonly totalMs: number;
}

export interface AlignmentMapping {
  readonly configured: boolean;
  readonly coverage: AlignmentMappingCoverage;
  readonly operations: readonly AlignmentMappedOperation[];
  readonly unmappedMeasuredKernels: readonly AlignmentUnmappedKernel[];
  readonly unmappedSimulatedSlots: readonly AlignmentUnmappedSlot[];
}

/** Per-operation error statistics over every paired iteration. */
export interface AlignmentOperationStats {
  readonly operation: string;
  readonly nPaired: number;
  readonly missingMeasured: number;
  readonly missingSimulated: number;
  readonly measuredMs: AlignmentDistribution;
  readonly simulatedMs: AlignmentDistribution;
  readonly deltaMs: AlignmentDistribution;
  readonly relativeDiffPct: AlignmentDistribution;
  readonly absRelativeErrorPct: AlignmentDistribution;
}

export interface AlignmentTotalStats {
  readonly deltaMs: AlignmentDistribution;
  readonly relativeDiffPct: AlignmentDistribution;
  readonly absRelativeErrorPct: AlignmentDistribution;
}

export interface AlignmentIterationReport {
  readonly available: boolean;
  readonly definitions: AlignmentDefinitions;
  readonly meta: {
    readonly iterations: number;
    readonly recommendedGpuTimeMultiplier: number;
    readonly representativeDeviceId: number;
    readonly measuredDeviceIds: readonly number[];
    readonly measuredPhases: readonly string[];
  };
  readonly iterations: readonly AlignmentPairedIteration[];
  readonly kernels: readonly AlignmentKernelRow[];
  readonly mapping: AlignmentMapping;
  readonly operations: readonly AlignmentOperationStats[];
  readonly totalIteration: AlignmentTotalStats;
}

/** A labelled kernel, as the labeler wrote it. `label.status` is `mapped` only
 * when the labeler tied it to simulated slots. */
export interface AlignmentSequenceKernel {
  readonly name: string;
  readonly suggestedCategory: string;
  readonly label: {
    readonly status: string;
    readonly crossRank: string;
    readonly operation?: string;
    readonly role?: string;
    readonly type?: string;
    readonly simulatedSlots?: readonly string[];
  };
}

/** One run of the folded program: `repeat` copies of `kernels` back to back.
 * The fold is the labeler's, kept rather than expanded so a 451-kernel forward
 * pass reads as a 32× layer body. */
export interface AlignmentSequenceSegment {
  readonly repeat: number;
  readonly kernels: readonly AlignmentSequenceKernel[];
}

export interface AlignmentSequence {
  readonly sequenceId: string;
  readonly expandedKernelCount: number;
  readonly iterations: readonly number[];
  readonly program: readonly AlignmentSequenceSegment[];
}

export interface AlignmentSequences {
  readonly encoding: string;
  readonly foldingPolicy: Readonly<Record<string, unknown>>;
  readonly representativeDeviceId: number;
  readonly deviceIds: readonly number[];
  /** Phase name (`forward`, `preprocess`, …) to the distinct programs seen. */
  readonly phases: Readonly<Record<string, readonly AlignmentSequence[]>>;
}

/** Where one iteration's detail record lives in the subject's shard. */
export interface AlignmentDetailIndex {
  readonly file: string;
  readonly encoding: string;
  readonly iterationIds: readonly number[];
}

export interface AlignmentIterationSeries {
  readonly definitions: AlignmentDefinitions;
  readonly meta: {
    readonly recommendedGpuTimeMultiplier: number;
    readonly measuredPhases: readonly string[];
  };
  readonly iterations: readonly AlignmentPairedIteration[];
  readonly sequences: AlignmentSequences | null;
  readonly breakdownDetail: AlignmentDetailIndex | null;
}

/** One measured kernel occurrence folded across ranks, for one iteration. */
export interface AlignmentBreakdownMeasuredKernel {
  readonly rowId: string | null;
  readonly name: string;
  readonly category: string;
  /** The NSYS phase this occurrence ran in. Null on a payload written
   * before the analyzer carried it; a lane that draws phase spans then
   * draws none rather than guessing one. */
  readonly phase: string | null;
  readonly operation: string | null;
  readonly durationMs: number;
  readonly calls: number;
  readonly firstStartNs: number;
  readonly deviceIds: readonly number[];
}

export interface AlignmentBreakdownSimulatedKernel {
  readonly slotIndex: number;
  readonly name: string;
  readonly kind: string;
  readonly operation: string | null;
  readonly unitMs: number;
  readonly foldedMs: number;
  readonly multiplicity: number;
}

export interface AlignmentBreakdownOperation {
  readonly operation: string;
  readonly measuredMs: number;
  readonly simulatedMs: number;
  readonly deltaMs: number;
  readonly relativeDiffPct: number;
}

export interface AlignmentBreakdownPhase {
  readonly phase: string;
  readonly deviceId: number;
  readonly kernelCount: number;
  readonly kernelSumMs: number;
  readonly busyUnionMs: number;
}

/** The `iteration` subject's per-iteration shard record. */
export interface AlignmentBreakdown {
  readonly iterationId: number;
  readonly caseIndex: number;
  readonly stage: string;
  readonly measuredKernelSumMs: number;
  readonly simulatedLeafWorkloadMs: number;
  readonly unmappedMeasuredMs: number;
  readonly unmappedSimulatedMs: number;
  readonly measuredKernels: readonly AlignmentBreakdownMeasuredKernel[];
  readonly simulatedKernels: readonly AlignmentBreakdownSimulatedKernel[];
  readonly operationSummary: readonly AlignmentBreakdownOperation[];
  readonly phaseSummary: readonly AlignmentBreakdownPhase[];
}

// ---- timeline subject -----------------------------------------------------

/** A host thread as nsys saw it. `deviceId` is null for the scheduler thread,
 * which owns no GPU — the reason a host lane exists at all: its time is
 * invisible on the device side. */
export interface AlignmentHostThread {
  readonly globalTid: number;
  readonly deviceId: number | null;
  readonly process: string;
  readonly role: string;
  readonly main: boolean;
}

export interface AlignmentHostTimelineMeta {
  readonly source: string;
  readonly windowRule: string;
  readonly ownershipRule: string;
  readonly apiClasses: readonly string[];
  readonly threads: readonly AlignmentHostThread[];
  readonly strings: readonly string[];
  readonly unclosedNvtxMarks: number;
}

/** `[startNs, durationNs, stringId, depthOrClassIndex, correlationId?]`.
 *
 * Kept packed. One iteration carries tens of thousands of these and a renderer
 * walks them by index; inflating each into an object would cost more than the
 * fetch. `stringId` indexes `AlignmentHostTimelineMeta.strings`; the fourth
 * number is measured nesting depth for NVTX rows and an index into
 * `apiClasses` for CUDA runtime rows. The optional fifth value is the NSYS
 * correlation id of a CUDA runtime launch.
 */
export type AlignmentHostEvent =
  | readonly [number, number, number, number]
  | readonly [number, number, number, number, number | null];

/** Host events by thread index into `AlignmentHostTimelineMeta.threads`. */
export type AlignmentHostLane = Readonly<Record<number, readonly AlignmentHostEvent[]>>;

export interface AlignmentTimelineMeta {
  readonly anchorRule: string;
  readonly selectionRule: string;
  readonly timeBase: string;
  readonly timeOriginNs: number;
  readonly referenceDeviceId: number;
  readonly measuredDeviceIds: readonly number[];
  readonly recommendedGpuTimeMultiplier: number;
  readonly iterationsAvailable: number;
  readonly iterationsEmitted: number;
  readonly iterationsReported: number;
  readonly hostTimeline: AlignmentHostTimelineMeta | null;
}

/** The picker's row: every scalar it sorts or filters on, and nothing that
 * would require reading the shard. */
export interface AlignmentTimelineIterationSummary {
  readonly iterationId: number;
  readonly caseIndex: number;
  readonly iterationType: string;
  readonly stage: string;
  readonly identitySequence: string;
  readonly selectedAs: string;
  readonly anchorNs: number;
  readonly spanMs: number;
  readonly busyMs: number;
  readonly idleMs: number;
  readonly idleFraction: number;
  readonly gapCount: number;
  readonly hasHostLane: boolean;
  readonly measuredMs: number;
  readonly simulatedMs: number;
  readonly relativeDiffPct: number;
  readonly measuredGpuCycleMs: number | null;
  readonly simulatedGpuCycleMs: number | null;
}

export interface AlignmentTimelineIndex {
  readonly definitions: AlignmentDefinitions;
  readonly meta: AlignmentTimelineMeta;
  readonly iterations: readonly AlignmentTimelineIterationSummary[];
  /** Kernel name by id, as `AlignmentTimelineKernel.nameId` references it. */
  readonly kernelNames: Readonly<Record<number, string>>;
  readonly operations: readonly AlignmentMappedOperation[];
  /** Each simulated slot's exact CostTree Scale multiplicity. Shared by every
   * iteration because the tree shape is static. */
  readonly slotMultiplicity: readonly number[];
  /** The modelled leaves, in slot order — the names and kinds behind
   * `AlignmentTimelineIteration.simulated.slotMs`. */
  readonly simSlots: readonly AlignmentSimSlot[];
  /** The cost tree those leaves hang off, flattened. Empty for a payload
   * written without a sim manifest, which is why the lane keeps a shape that
   * needs only `slotMultiplicity`. */
  readonly simNodes: readonly AlignmentCostNode[];
  readonly iterationDetail: AlignmentDetailIndex | null;
}

/** A half-open `[start, end)` range into the flattened node array. */
export type AlignmentNodeChildren = readonly [number, number];

/**
 * One node of the flattened cost tree.
 *
 * The four kinds are how the model aggregates time, and they are not
 * interchangeable when the tree is drawn: `sum` is sequence, `scale` is
 * repetition, and `max` is concurrency — its branches share one span, so
 * laying them end to end would report overlapped work as elapsed time.
 */
export type AlignmentCostNode =
  | { readonly kind: 'leaf'; readonly slotIndex: number }
  | { readonly kind: 'sum'; readonly children: AlignmentNodeChildren }
  | { readonly kind: 'max'; readonly overlap: number; readonly children: AlignmentNodeChildren }
  | { readonly kind: 'scale'; readonly repeats: number; readonly children: AlignmentNodeChildren };

/** One leaf of the cost tree. `kind` is a cost-tree kind (`single_gemm`,
 * `rms_norm`, …), so it colours from the same family table as every other
 * page rather than from an alignment-only palette. */
export interface AlignmentSimSlot {
  readonly name: string;
  readonly kind: string;
}

/**
 * One rank's launch of a kernel position. The optional fourth value is the
 * NSYS correlation id shared with the CUDA runtime launch; the three-value form
 * is retained for older timeline shards that predate launch links.
 */
export type AlignmentKernelInterval =
  readonly [number, number, number] | readonly [number, number, number, number | null];

export interface AlignmentTimelineKernel {
  readonly nameId: number;
  readonly rowId: string;
  readonly category: string;
  readonly phase: string;
  readonly operation: string | null;
  readonly synchronizing: boolean;
  /** This occurrence's cross-rank critical-path contribution. */
  readonly occurrenceNs: number;
  readonly intervals: readonly AlignmentKernelInterval[];
}

export interface AlignmentTimelineOperationTotal {
  readonly operation: string;
  readonly measuredMs: number;
  readonly simulatedMs: number;
  readonly measuredOccurrences: number;
  readonly simulatedOccurrences: number;
  readonly occurrenceRatio: number;
}

/** The `timeline` subject's per-iteration shard record: both lanes of one
 * iteration on one axis, plus the host events overlapping its window. */
export interface AlignmentTimelineIteration {
  readonly iterationId: number;
  readonly caseIndex: number;
  readonly iterationType: string;
  readonly stage: string;
  readonly identitySequence: string;
  readonly selectedAs: string;
  readonly anchorNs: number;
  readonly gpuSpanNs: readonly [number, number];
  readonly measuredGpuCycleMs: number | null;
  readonly simulatedGpuCycleMs: number | null;
  readonly measured: {
    readonly criticalPathMs: number;
    readonly busyUnionMs: number;
    readonly kernels: readonly AlignmentTimelineKernel[];
  };
  readonly simulated: {
    readonly totalMs: number;
    readonly slotMs: readonly number[];
    readonly slotOperation: readonly (string | null)[];
  };
  readonly operationTotals: readonly AlignmentTimelineOperationTotal[];
  readonly host: {
    readonly windowNs: readonly [number, number];
    readonly nvtx: AlignmentHostLane;
    readonly api: AlignmentHostLane;
  } | null;
}

// ---- e2e half ------------------------------------------------------------

/** One scheduler-iteration series. Measured and simulated keep their own
 * iteration ids: the two sides are not paired here, only overlaid. */
export interface AlignmentWorkloadSide {
  readonly iterationId: readonly number[];
  readonly timeMs: readonly number[];
  readonly iterationCycleMs: readonly (number | null)[];
  readonly prefillTokens: readonly number[];
  readonly decodeBatchSize: readonly number[];
  readonly scheduledKvTokens: readonly number[];
}

export interface AlignmentWorkloadSeries {
  readonly available: boolean;
  readonly definitions: AlignmentDefinitions;
  readonly measured: AlignmentWorkloadSide | null;
  readonly simulated: AlignmentWorkloadSide | null;
}

export interface AlignmentWorkloadReport {
  readonly available: boolean;
  readonly definitions: AlignmentDefinitions;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly metrics: Readonly<
    Record<
      string,
      {
        readonly measured: AlignmentDistribution;
        readonly simulated: AlignmentDistribution;
      }
    >
  >;
}

export interface AlignmentCdfCurve {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly n: number;
  readonly x: readonly number[];
  readonly yPct: readonly number[];
  readonly markers: Readonly<Record<string, number>>;
}

export interface AlignmentCdfComparison {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly measured: AlignmentCdfCurve;
  readonly simulated: AlignmentCdfCurve;
}

export interface AlignmentThroughputSeries {
  readonly tStartMs: readonly number[];
  readonly tEndMs: readonly number[];
  readonly measuredOutputTps: readonly number[];
  readonly simulatedOutputTps: readonly number[];
}

export interface AlignmentE2eSeries {
  readonly definitions: AlignmentDefinitions;
  readonly latencyCdfComparisons: readonly AlignmentCdfComparison[];
  readonly throughput: AlignmentThroughputSeries | null;
  readonly throughputSummary: Readonly<Record<string, number>>;
}

export interface AlignmentE2eReport {
  readonly available: boolean;
  readonly definitions: AlignmentDefinitions;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly latency: Readonly<
    Record<
      string,
      {
        readonly measuredMs: AlignmentDistribution;
        readonly simulatedMs: AlignmentDistribution;
      }
    >
  >;
  readonly throughput: Readonly<Record<string, number>>;
}
