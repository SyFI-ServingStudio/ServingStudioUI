import type {
  RunDescriptor,
  RunListItem,
  RunSummaryArtifact,
  TraceResource,
} from '../domain/artifacts';
import type { Topology } from '../domain/run';
import type { ModelConfigResource, WorkloadOverviewResource } from '../domain/overviewResources';
import type { SubjectName, SubjectResult } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import type { KernelThroughputAnalysis } from '../domain/kernelThroughputAnalysis';
import type {
  OptimalityIterationWaterfall,
  OptimalityKernelLadder,
  OptimalityMode,
} from '../domain/optimality';
import type {
  WorkerCostTreeDetail,
  WorkerCostTreeRef,
  WorkerOperationBuffer,
  WorkerOperationSeekResult,
} from '../domain/workerOperation';
import type {
  ScopedOptimalityReport,
  ScopedOptimalitySelector,
} from '../domain/scopedOptimality';
import type { SweepAnalysis, SweepListItem } from '../domain/sweep';
import type {
  PredictionCasePage,
  PredictionCostTreeDetail,
  PredictionDescriptor,
  PredictionKernelThroughputAnalysis,
  PredictionOptimalityKernelLadder,
  PredictionOptimalityWaterfall,
} from '../domain/prediction';
import type {
  AlignmentBreakdown,
  AlignmentDescriptor,
  AlignmentE2eReport,
  AlignmentE2eSeries,
  AlignmentIterationReport,
  AlignmentIterationSeries,
  AlignmentTimelineIndex,
  AlignmentTimelineIteration,
  AlignmentWorkloadReport,
  AlignmentWorkloadSeries,
} from '../domain/alignment';
import type {
  HardwareGpu,
  KernelMeasurementDescriptor,
  KernelMeasurementSummary,
  KernelProfileCurve,
  KernelProfileDescriptor,
  OfflineResourceCatalogItem,
} from '../domain/offlineResource';

/**
 * The only analyzer-data boundary visible to application features.
 * Implementations own path resolution, transport, runtime validation and v1
 * normalization; components must never concatenate run artifact paths.
 */
export interface AnalyzerRepository {
  listRuns(): Promise<readonly RunListItem[]>;

  listSweeps(): Promise<readonly SweepListItem[]>;

  getSweep(sweepId: string): Promise<SweepAnalysis>;

  getRunSummary(runId: string): Promise<RunSummaryArtifact>;

  getRunTopology(runId: string): Promise<Topology>;

  getRunModel(runId: string): Promise<ModelConfigResource>;

  getRunWorkload(runId: string): Promise<WorkloadOverviewResource>;

  getRunDescriptor(runId: string): Promise<RunDescriptor>;

  getSubject<Name extends SubjectName>(
    runId: string,
    subject: Name,
    variant?: string,
  ): Promise<SubjectResult<Name>>;

  /** Read only the independently versioned `worker-cost-tree` detail declared
   * by RunDescriptor.details. Aggregate kernel-time subjects never satisfy it. */
  getWorkerOperations(
    runId: string,
    worker: WorkerRef,
    page: { offset: number; limit: number },
  ): Promise<WorkerOperationBuffer>;

  getWorkerOperationSeek(
    runId: string,
    worker: WorkerRef,
    atMs: number,
    limit: number,
  ): Promise<WorkerOperationSeekResult>;

  getWorkerCostTree(runId: string, ref: WorkerCostTreeRef): Promise<WorkerCostTreeDetail>;

  /** Optional live detail: scoped optimality (R0/R5/R6/R7) computed on demand
   * for one CostTree subtree, selected by ordinal path or exact label. */
  getScopedOptimality?(
    runId: string,
    selector: ScopedOptimalitySelector,
  ): Promise<ScopedOptimalityReport>;

  /** Prediction twin of getScopedOptimality — the artifact layout is the
   * same, only the catalog naming the directory differs. */
  getPredictionScopedOptimality?(
    predictionId: string,
    selector: ScopedOptimalitySelector,
  ): Promise<ScopedOptimalityReport>;

  /** Optional because static artifact repositories do not have a live Rust
   * cache process. The live HTTP repository implements this capability. */
  getKernelThroughputAnalysis?(
    runId: string,
    ref: WorkerCostTreeRef,
    leafId: number,
  ): Promise<KernelThroughputAnalysis>;

  /** Optional live detail: exact all-row optimality fold for one worker iteration. */
  getIterationOptimalityKernelLadder?(
    runId: string,
    worker: WorkerRef,
    iterId: string,
    mode: OptimalityMode,
  ): Promise<OptimalityKernelLadder>;

  /** Optional live detail: full all-row waterfall for one worker iteration. */
  getIterationOptimalityWaterfall?(
    runId: string,
    worker: WorkerRef,
    iterId: string,
    mode: OptimalityMode,
  ): Promise<OptimalityIterationWaterfall>;

  /** Return an addressable trace; repositories do not copy trace bytes into UI state. */
  getTrace(runId: string, traceName: string): Promise<TraceResource>;

  /** Timing predictions are first-class Analyzer resources. They deliberately
   * expose prediction/case/operation identity instead of fake run workers. */
  getPredictionDescriptor?(predictionId: string): Promise<PredictionDescriptor>;

  getPredictionCases?(
    predictionId: string,
    page: { offset: number; limit: number },
  ): Promise<PredictionCasePage>;

  getPredictionCostTree?(
    predictionId: string,
    caseId: string,
    operationId: string,
  ): Promise<PredictionCostTreeDetail>;

  getPredictionKernelThroughputAnalysis?(
    predictionId: string,
    caseId: string,
    operationId: string,
    leafId: number,
  ): Promise<PredictionKernelThroughputAnalysis>;

  getPredictionKernelInputDistribution?(
    predictionId: string,
  ): Promise<SubjectResult<'kernelInputDistribution'>>;

  getPredictionOptimalityKernelLadder?(
    predictionId: string,
    caseId: string,
    mode: OptimalityMode,
  ): Promise<PredictionOptimalityKernelLadder>;

  getPredictionOptimalityWaterfall?(
    predictionId: string,
    caseId: string,
    mode: OptimalityMode,
  ): Promise<PredictionOptimalityWaterfall>;

  /** An alignment bundle pairs a measured capture with the prediction of the
   * same shapes. Its two analysis halves are independent, so a caller asks for
   * one subject at a time rather than for a whole bundle. */
  getAlignmentDescriptor?(alignmentId: string): Promise<AlignmentDescriptor>;

  getAlignmentIterationReport?(alignmentId: string): Promise<AlignmentIterationReport>;

  getAlignmentIterationSeries?(alignmentId: string): Promise<AlignmentIterationSeries>;

  getAlignmentTimelineIndex?(alignmentId: string): Promise<AlignmentTimelineIndex>;

  getAlignmentWorkloadReport?(alignmentId: string): Promise<AlignmentWorkloadReport>;

  getAlignmentWorkloadSeries?(alignmentId: string): Promise<AlignmentWorkloadSeries>;

  getAlignmentE2eReport?(alignmentId: string): Promise<AlignmentE2eReport>;

  getAlignmentE2eSeries?(alignmentId: string): Promise<AlignmentE2eSeries>;

  /** One iteration out of a subject's detail shard. The whole shard is
   * hundreds of megabytes; the service reads this record by byte range. */
  getAlignmentBreakdown?(alignmentId: string, iterationId: number): Promise<AlignmentBreakdown>;

  getAlignmentTimelineIteration?(
    alignmentId: string,
    iterationId: number,
  ): Promise<AlignmentTimelineIteration>;

  /** Offline results are discovered from Analyzer; conversation state is only
   * an ownership overlay and never supplies these payloads. */
  listOfflineResources?(): Promise<readonly OfflineResourceCatalogItem[]>;
  getKernelProfileDescriptor?(profileId: string): Promise<KernelProfileDescriptor>;
  getKernelProfileCurve?(profileId: string): Promise<KernelProfileCurve>;
  getKernelMeasurementDescriptor?(measurementId: string): Promise<KernelMeasurementDescriptor>;
  getKernelMeasurementSummary?(measurementId: string): Promise<KernelMeasurementSummary>;
  getHardwareGpu?(gpuName: string): Promise<HardwareGpu>;
}
