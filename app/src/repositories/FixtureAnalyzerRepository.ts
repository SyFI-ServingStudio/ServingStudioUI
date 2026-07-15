import type {
  RunDescriptor,
  RunListItem,
  SubjectArtifact,
  TraceResource,
} from '../domain/artifacts';
import type { BatchSubject, Run } from '../domain/run';
import {
  SUBJECT_NAMES,
  type SubjectName,
  type SubjectPayloadByName,
  type SubjectResult,
} from '../domain/subject';
import { makeWorkerKey, type WorkerKey, type WorkerRef } from '../domain/worker';
import { iterationsFor, type Iteration, type IterTimeline } from '../data/iterations';
import { batchFor, conservationFor } from '../data/scopeData';
import type { CostTree } from '../data/tree';
import type { AnalyzerRepository } from './AnalyzerRepository';

const FIXTURE_SCHEMA_VERSION = 1;
type FixtureRunLoader = () => Promise<readonly Run[]>;
export type FixtureWorkerCostTreeIndex = ReadonlyMap<string, ReadonlyMap<WorkerKey, CostTree>>;

export class FixtureDetailUnavailableError extends Error {
  readonly status = 'unavailable' as const;

  constructor(
    readonly runId: string,
    readonly workerKey: WorkerKey,
  ) {
    super(`Fixture run ${runId} has no declared worker-cost-tree detail for ${workerKey}.`);
    this.name = 'FixtureDetailUnavailableError';
  }
}

async function loadBundledRuns(): Promise<readonly Run[]> {
  const fixtureModule = await import('../data/realRunFixture');
  return fixtureModule.REAL_RUNS;
}

/**
 * Async facade over checked-in deterministic fixtures. A fixture may be a
 * bounded copy of real analyzer output; provenance keeps that distinct from
 * hand-authored synthetic development data.
 */
export class FixtureAnalyzerRepository implements AnalyzerRepository {
  private runsPromise: Promise<readonly Run[]> | null;

  constructor(
    configuredRuns?: readonly Run[],
    private readonly runLoader: FixtureRunLoader = loadBundledRuns,
    private readonly workerCostTrees: FixtureWorkerCostTreeIndex = new Map(),
  ) {
    this.runsPromise = configuredRuns === undefined ? null : Promise.resolve(configuredRuns);
  }

  async listRuns(): Promise<readonly RunListItem[]> {
    const runs = await this.getRuns();
    return runs.map((run) => ({
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

  async getRunSummary(runId: string) {
    const summary = (await this.requireRun(runId)).summary;
    return {
      totalTokS: summary.total_tok_s,
      numGpus: summary.num_gpus,
      requestsFinished: summary.requests,
      ...(summary.requests_total === undefined ? {} : { requestsTotal: summary.requests_total }),
    };
  }

  async getRunTopology(runId: string) {
    return (await this.requireRun(runId)).topology;
  }

  async getRunDescriptor(runId: string): Promise<RunDescriptor> {
    const run = await this.requireRun(runId);
    const workerCostTrees = this.workerCostTrees.get(run.id);
    const payloads = this.subjectPayloads(run);
    const subjects: RunDescriptor['subjects'] = {};
    for (const subject of SUBJECT_NAMES) {
      subjects[subject] =
        payloads[subject] === undefined
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
      details: {
        'worker-cost-tree':
          workerCostTrees === undefined
            ? {
                status: 'not_generated',
                reason: 'This fixture has no independently versioned hierarchical CostTree.',
              }
            : {
                status: 'ready',
                schemaVersion: FIXTURE_SCHEMA_VERSION,
                resource: {
                  href: `fixture://${encodeURIComponent(runId)}/details/worker-cost-tree`,
                },
              },
      },
      traces: {
        perfetto:
          run.source.kind === 'synthetic' && run.capabilities.perfettoTrace
            ? {
                status: 'ready',
                artifact: {
                  href: run.deployment === 'afd' ? 'afd_smoke.pftrace.gz' : 'pd_smoke.pftrace.gz',
                  mediaType: 'application/gzip',
                },
              }
            : {
                status: 'not_generated',
                reason: 'This simulation folder has no Perfetto trace artifact.',
              },
      },
      analysis: {
        revision: `fixture-${run.id}-v${FIXTURE_SCHEMA_VERSION}`,
        generatedAt: '2026-07-15T00:00:00Z',
        generatorVersion: `fixture-v${FIXTURE_SCHEMA_VERSION}`,
      },
      provenance: {
        source: 'fixture',
        synthetic: run.source.kind === 'synthetic',
        fixtureId: run.id,
        sourceRun: run.source.simulationFolder,
      },
    };
  }

  async getSubject<Name extends SubjectName>(
    runId: string,
    subject: Name,
  ): Promise<SubjectResult<Name>> {
    const run = await this.requireRun(runId);
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

  async getWorkerCostTree(runId: string, worker: WorkerRef): Promise<CostTree> {
    await this.requireRun(runId);
    const workerKey = makeWorkerKey(worker);
    const tree = this.workerCostTrees.get(runId)?.get(workerKey);
    if (tree === undefined) throw new FixtureDetailUnavailableError(runId, workerKey);
    return tree;
  }

  async getWorkerTimeline(runId: string, worker: WorkerRef): Promise<IterTimeline> {
    const run = await this.requireRun(runId);
    if (run.source.kind !== 'synthetic' || !run.capabilities.workerIterations) {
      throw new Error(`Simulation folder ${runId} has no worker-iteration artifact.`);
    }
    return iterationsFor(run, makeWorkerKey(worker));
  }

  async getIteration(runId: string, worker: WorkerRef, iterationId: string): Promise<Iteration> {
    const timeline = await this.getWorkerTimeline(runId, worker);
    const iteration = timeline.iters.find((candidate) => String(candidate.id) === iterationId);
    if (!iteration) {
      throw new Error(
        `Unknown iteration ${iterationId} for ${worker.poolTag}/${worker.workerId} in run ${runId}`,
      );
    }
    return iteration;
  }

  async getTrace(runId: string, traceName: string): Promise<TraceResource> {
    const descriptor = await this.getRunDescriptor(runId);
    return (
      descriptor.traces[traceName] ?? {
        status: 'not_generated',
        reason: `Simulation folder ${runId} does not provide trace ${traceName}.`,
      }
    );
  }

  /** StrictMode and concurrent queries share one module request. A rejected
   * import is evicted so React Query can perform a real retry. */
  private getRuns(): Promise<readonly Run[]> {
    if (this.runsPromise !== null) return this.runsPromise;

    this.runsPromise = this.runLoader().catch((error: unknown) => {
      this.runsPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load bundled analyzer fixtures: ${detail}`);
    });
    return this.runsPromise;
  }

  private async requireRun(runId: string): Promise<Run> {
    const runs = await this.getRuns();
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Unknown fixture run id: ${runId}`);
    return run;
  }

  private subjectPayloads(run: Run): Partial<SubjectPayloadByName> {
    const batchByPool =
      run.payloads.batchByPool ??
      (run.source.kind === 'synthetic'
        ? Object.fromEntries(
            run.topology.pools.map((pool) => [pool.role, batchFor(run, pool.role)]),
          )
        : undefined);
    const batch: BatchSubject | undefined =
      batchByPool === undefined ? undefined : { pools: batchByPool };
    const conservation =
      run.payloads.conservation ??
      (run.source.kind === 'synthetic' ? conservationFor(run) : undefined);

    return {
      slo: run.payloads.slo,
      throughput: run.payloads.throughput,
      utilization: run.payloads.utilization,
      kv: run.payloads.kv,
      ...(run.payloads.concurrency === undefined ? {} : { concurrency: run.payloads.concurrency }),
      ...(run.payloads.pendingQueue === undefined
        ? {}
        : { backpressure: run.payloads.pendingQueue }),
      ...(batch === undefined ? {} : { batch }),
      ...(conservation === undefined ? {} : { conservation }),
      ...(run.payloads.kernelInputDistribution === undefined
        ? {}
        : { kernelInputDistribution: run.payloads.kernelInputDistribution }),
      ...(run.payloads.kernelTimeShare === undefined
        ? {}
        : { kernelTimeShare: run.payloads.kernelTimeShare }),
    };
  }

  private missingSubject(run: Run, subject: SubjectName): SubjectArtifact {
    if (run.source.kind !== 'synthetic' && subject === 'kernelInputDistribution') {
      return {
        status: 'unavailable',
        code: 'missing_kernel_input_columns',
        reason:
          'The source run did not log slot_backend/slot_input, so this analyzer subject is unavailable.',
      };
    }
    return {
      status: 'not_generated',
      reason: `Simulation folder ${run.source.simulationFolder} does not provide ${subject}.`,
    };
  }
}

export const fixtureAnalyzerRepository = new FixtureAnalyzerRepository();
