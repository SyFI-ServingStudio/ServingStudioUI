import type {
  RunDescriptor,
  RunListItem,
  RunSummaryArtifact,
  TraceResource,
} from '../domain/artifacts';
import type { Topology } from '../domain/run';
import type { SubjectName, SubjectResult } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import type { Iteration, IterTimeline } from '../data/iterations';
import type { CostNode } from '../data/tree';

/**
 * The only analyzer-data boundary visible to application features.
 * Implementations own path resolution, transport, runtime validation and v1
 * normalization; components must never concatenate run artifact paths.
 */
export interface AnalyzerRepository {
  listRuns(): Promise<readonly RunListItem[]>;

  getRunSummary(runId: string): Promise<RunSummaryArtifact>;

  getRunTopology(runId: string): Promise<Topology>;

  getRunDescriptor(runId: string): Promise<RunDescriptor>;

  getSubject<Name extends SubjectName>(runId: string, subject: Name): Promise<SubjectResult<Name>>;

  getWorkerCostTree(runId: string, worker: WorkerRef): Promise<CostNode>;

  getWorkerTimeline(runId: string, worker: WorkerRef): Promise<IterTimeline>;

  getIteration(runId: string, worker: WorkerRef, iterationId: string): Promise<Iteration>;

  /** Return an addressable trace; repositories do not copy trace bytes into UI state. */
  getTrace(runId: string, traceName: string): Promise<TraceResource>;
}
