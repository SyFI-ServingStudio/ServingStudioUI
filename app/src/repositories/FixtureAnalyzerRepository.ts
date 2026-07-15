import type { RunDescriptor, RunListItem, SubjectArtifact, TraceResource } from '../domain/artifacts';
import type { BatchSubject, Run } from '../domain/run';
import { SUBJECT_NAMES, type SubjectName, type SubjectPayloadByName, type SubjectResult } from '../domain/subject';
import { makeWorkerKey, type WorkerRef } from '../domain/worker';
import { REAL_RUNS } from '../data/realRunFixture';
import { iterationsFor, type Iteration, type IterTimeline } from '../data/iterations';
import { batchFor, conservationFor } from '../data/scopeData';
import type { CostNode } from '../data/tree';
import type { AnalyzerRepository } from './AnalyzerRepository';

const FIXTURE_SCHEMA_VERSION = 1;

/**
 * Async facade over checked-in deterministic fixtures. A fixture may be a
 * bounded copy of real analyzer output; provenance keeps that distinct from
 * hand-authored synthetic development data.
 */
export class FixtureAnalyzerRepository implements AnalyzerRepository {
  constructor(private readonly runs: readonly Run[] = REAL_RUNS) {}

  async listRuns(): Promise<readonly RunListItem[]> {
    return this.runs.map((run) => ({
      runId: run.id,
      kind: 'simulation',
      displayName: run.name,
      modelName: run.model,
      deployment: run.deployment,
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      provenance: {
        source: 'fixture',
        synthetic: run.source.kind === 'synthetic',
        fixtureId: run.id,
        sourceRun: run.source.simulationFolder,
      },
    }));
  }

  async getRunDescriptor(runId: string): Promise<RunDescriptor> {
    const run = this.requireRun(runId);
    const payloads = this.subjectPayloads(run);
    const subjects: RunDescriptor['subjects'] = {};
    for (const subject of SUBJECT_NAMES) {
      subjects[subject] = payloads[subject] === undefined
        ? this.missingSubject(run, subject)
        : {
            status: 'ready',
            schemaVersion: FIXTURE_SCHEMA_VERSION,
            payload: { href: `fixture://${encodeURIComponent(runId)}/payloads/${subject}.json` },
          };
    }

    return {
      protocolVersion: 1,
      runId: run.id,
      kind: 'simulation',
      displayName: run.name,
      modelName: run.model,
      deployment: run.deployment,
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      summary: { href: `fixture://${encodeURIComponent(runId)}/summary.json` },
      model: { href: `fixture://${encodeURIComponent(runId)}/model.json` },
      topology: { href: `fixture://${encodeURIComponent(runId)}/topology.json` },
      workers: run.workerList.map((worker) => worker.ref),
      subjects,
      traces: {
        perfetto: run.source.kind === 'synthetic' && run.capabilities.perfettoTrace
          ? {
              status: 'ready',
              artifact: {
                href: run.deployment === 'afd' ? 'afd_smoke.pftrace.gz' : 'pd_smoke.pftrace.gz',
                mediaType: 'application/gzip',
              },
            }
          : { status: 'not_generated', reason: 'This simulation folder has no Perfetto trace artifact.' },
      },
      provenance: {
        source: 'fixture',
        synthetic: run.source.kind === 'synthetic',
        fixtureId: run.id,
        sourceRun: run.source.simulationFolder,
      },
    };
  }

  async getSubject<Name extends SubjectName>(runId: string, subject: Name): Promise<SubjectResult<Name>> {
    const run = this.requireRun(runId);
    const payloads = this.subjectPayloads(run);
    const payload = payloads[subject];
    if (payload === undefined) {
      const missing = this.missingSubject(run, subject);
      return {
        subject,
        ...missing,
      } as SubjectResult<Name>;
    }
    return {
      subject,
      status: 'ready',
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      payload,
    } as SubjectResult<Name>;
  }

  async getWorkerCostTree(runId: string, worker: WorkerRef): Promise<CostNode> {
    const run = this.requireRun(runId);
    const tree = run.trees[makeWorkerKey(worker)];
    if (!tree) throw new Error(`Unknown worker ${worker.poolTag}/${worker.workerId} in run ${runId}`);
    return tree;
  }

  async getWorkerTimeline(runId: string, worker: WorkerRef): Promise<IterTimeline> {
    const run = this.requireRun(runId);
    if (run.source.kind !== 'synthetic' || !run.capabilities.workerIterations) {
      throw new Error(`Simulation folder ${runId} has no worker-iteration artifact.`);
    }
    return iterationsFor(run, makeWorkerKey(worker));
  }

  async getIteration(runId: string, worker: WorkerRef, iterationId: string): Promise<Iteration> {
    const timeline = await this.getWorkerTimeline(runId, worker);
    const iteration = timeline.iters.find((candidate) => String(candidate.id) === iterationId);
    if (!iteration) {
      throw new Error(`Unknown iteration ${iterationId} for ${worker.poolTag}/${worker.workerId} in run ${runId}`);
    }
    return iteration;
  }

  async getTrace(runId: string, traceName: string): Promise<TraceResource> {
    const descriptor = await this.getRunDescriptor(runId);
    return descriptor.traces[traceName] ?? {
      status: 'not_generated',
      reason: `Simulation folder ${runId} does not provide trace ${traceName}.`,
    };
  }

  private requireRun(runId: string): Run {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Unknown fixture run id: ${runId}`);
    return run;
  }

  private subjectPayloads(run: Run): Partial<SubjectPayloadByName> {
    const batchByPool = run.payloads.batchByPool
      ?? (run.source.kind === 'synthetic'
        ? Object.fromEntries(run.topology.pools.map((pool) => [pool.role, batchFor(run, pool.role)]))
        : undefined);
    const batch: BatchSubject | undefined = batchByPool === undefined ? undefined : { pools: batchByPool };
    const conservation = run.payloads.conservation
      ?? (run.source.kind === 'synthetic' ? conservationFor(run) : undefined);

    return {
      slo: run.payloads.slo,
      throughput: run.payloads.throughput,
      utilization: run.payloads.utilization,
      kv: run.payloads.kv,
      ...(run.payloads.concurrency === undefined ? {} : { concurrency: run.payloads.concurrency }),
      ...(run.payloads.pendingQueue === undefined ? {} : { backpressure: run.payloads.pendingQueue }),
      ...(batch === undefined ? {} : { batch }),
      ...(conservation === undefined ? {} : { conservation }),
      ...(run.payloads.kernelInputDistribution === undefined
        ? {}
        : { kernelInputDistribution: run.payloads.kernelInputDistribution }),
      ...(run.payloads.kernelTimeShare === undefined ? {} : { kernelTimeShare: run.payloads.kernelTimeShare }),
    };
  }

  private missingSubject(run: Run, subject: SubjectName): SubjectArtifact {
    if (run.source.kind !== 'synthetic' && subject === 'kernelInputDistribution') {
      return {
        status: 'unavailable',
        code: 'missing_kernel_input_columns',
        reason: 'The source run did not log slot_backend/slot_input, so this analyzer subject is unavailable.',
      };
    }
    return {
      status: 'not_generated',
      reason: `Simulation folder ${run.source.simulationFolder} does not provide ${subject}.`,
    };
  }
}

export const fixtureAnalyzerRepository = new FixtureAnalyzerRepository();
