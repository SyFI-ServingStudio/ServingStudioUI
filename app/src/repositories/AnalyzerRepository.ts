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
  WorkerCostTreeDetail,
  WorkerCostTreeRef,
  WorkerOperationBuffer,
  WorkerOperationSeekResult,
} from '../domain/workerOperation';

/**
 * The only analyzer-data boundary visible to application features.
 * Implementations own path resolution, transport, runtime validation and v1
 * normalization; components must never concatenate run artifact paths.
 */
export interface AnalyzerRepository {
  listRuns(): Promise<readonly RunListItem[]>;

  getRunSummary(runId: string): Promise<RunSummaryArtifact>;

  getRunTopology(runId: string): Promise<Topology>;

  getRunModel(runId: string): Promise<ModelConfigResource>;

  getRunWorkload(runId: string): Promise<WorkloadOverviewResource>;

  getRunDescriptor(runId: string): Promise<RunDescriptor>;

  getSubject<Name extends SubjectName>(runId: string, subject: Name): Promise<SubjectResult<Name>>;

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

  /** Optional because static artifact repositories do not have a live Rust
   * cache process. The live HTTP repository implements this capability. */
  getKernelThroughputAnalysis?(
    runId: string,
    ref: WorkerCostTreeRef,
    leafId: number,
  ): Promise<KernelThroughputAnalysis>;

  /** Return an addressable trace; repositories do not copy trace bytes into UI state. */
  getTrace(runId: string, traceName: string): Promise<TraceResource>;
}
