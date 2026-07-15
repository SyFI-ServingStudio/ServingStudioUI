import type { RunDescriptor, RunSummaryArtifact } from '../domain/artifacts';
import type { Payloads, Run, Topology, WorkerRow } from '../domain/run';
import {
  SUBJECT_NAMES,
  type SubjectName,
  type SubjectPayloadByName,
  type SubjectResult,
} from '../domain/subject';
import { makeWorkerKey, makeWorkerRef, type WorkerKey, type WorkerRef } from '../domain/worker';
import type { CostNode } from '../data/tree';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';

export type SubjectResults = { [Name in SubjectName]: SubjectResult<Name> };

export interface ActiveRunData {
  descriptor: RunDescriptor;
  subjects: SubjectResults;
  run: Run;
}

function requireReady<Name extends SubjectName>(
  subjects: SubjectResults,
  name: Name,
): SubjectPayloadByName[Name] {
  const result = subjects[name];
  if (result.status !== 'ready') {
    const reason = 'reason' in result && result.reason ? `: ${result.reason}` : '';
    throw new Error(`Required analyzer subject ${name} is ${result.status}${reason}`);
  }
  return result.payload;
}

function topologyWorkers(topology: Topology): WorkerRef[] {
  return topology.pools.flatMap((pool) =>
    pool.groups.flatMap((group) =>
      group.workers.map((worker) => makeWorkerRef(pool.role, worker.id)),
    ),
  );
}

function requireUniqueNonEmptyRoster(workers: readonly WorkerRef[], owner: string): WorkerRef[] {
  if (workers.length === 0) throw new Error(`${owner} has no workers.`);
  const keys = workers.map((worker) => makeWorkerKey(worker));
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${owner} contains duplicate composite worker identities.`);
  }
  return [...workers];
}

function requireSameWorkerRoster(
  descriptorWorkers: readonly WorkerRef[] | undefined,
  topology: Topology,
): WorkerRef[] {
  const topologyRoster = requireUniqueNonEmptyRoster(topologyWorkers(topology), 'Run topology');
  if (descriptorWorkers === undefined) return topologyRoster;

  const descriptorRoster = requireUniqueNonEmptyRoster(descriptorWorkers, 'Run descriptor');
  const descriptorKeys = new Set(descriptorRoster.map((worker) => makeWorkerKey(worker)));
  const topologyKeys = new Set(topologyRoster.map((worker) => makeWorkerKey(worker)));
  const sameRoster =
    descriptorKeys.size === topologyKeys.size &&
    [...descriptorKeys].every((key) => topologyKeys.has(key));
  if (!sameRoster)
    throw new Error('Run descriptor and topology disagree on the composite worker roster.');
  return descriptorRoster;
}

function buildWorkerRows(topology: Topology, trees: Record<WorkerKey, CostNode>): WorkerRow[] {
  return topology.pools.flatMap((pool) =>
    pool.groups.flatMap((group) =>
      group.workers.map((worker) => {
        const ref = makeWorkerRef(pool.role, worker.id);
        const key = makeWorkerKey(ref);
        const tree = trees[key];
        if (!tree) throw new Error(`Missing aggregate cost tree for ${key}.`);
        return {
          key,
          ref,
          id: worker.id,
          pool: pool.role,
          workerType: group.worker.type,
          archType: group.arch.type,
          gpu: group.gpu,
          gpuCount: worker.gpus.length,
          gpus: [...worker.gpus],
          dp: worker.dp ?? null,
          arch: group.arch,
          worker: group.worker,
          tree,
        };
      }),
    ),
  );
}

function assembleRun(
  descriptor: RunDescriptor,
  rootSummary: RunSummaryArtifact,
  topology: Topology,
  subjects: SubjectResults,
  trees: Record<WorkerKey, CostNode>,
): Run {
  const slo = requireReady(subjects, 'slo');
  const throughput = requireReady(subjects, 'throughput');
  const utilization = requireReady(subjects, 'utilization');
  const kv = requireReady(subjects, 'kv');
  const workerList = buildWorkerRows(topology, trees);
  const gpuNames = new Set(topology.pools.flatMap((pool) => pool.groups.map((group) => group.gpu)));
  if (gpuNames.size !== 1)
    throw new Error(
      `Run ${descriptor.runId} has ${gpuNames.size} GPU models; the current view requires one.`,
    );
  const gpu = [...gpuNames][0];
  const gpuTotal = topology.pools.reduce(
    (poolTotal, pool) =>
      poolTotal + pool.groups.reduce((groupTotal, group) => groupTotal + group.numGpus, 0),
    0,
  );
  if (gpuTotal !== rootSummary.numGpus)
    throw new Error('Run summary and topology disagree on GPU count.');

  const topologyModels = new Set(
    topology.pools.flatMap((pool) => pool.groups.map((group) => group.arch.model)),
  );
  if (topologyModels.size !== 1) {
    throw new Error(
      `Run ${descriptor.runId} has ${topologyModels.size} topology model identities; the current view requires one.`,
    );
  }
  const topologyModel = [...topologyModels][0];
  if (!topologyModel) throw new Error(`Run ${descriptor.runId} has no model identity.`);
  if (descriptor.modelName !== undefined && descriptor.modelName !== topologyModel) {
    throw new Error('Run descriptor and topology disagree on model identity.');
  }
  const model = descriptor.modelName ?? topologyModel;

  const payloads: Payloads = {
    slo,
    throughput,
    utilization,
    kv,
    ...(subjects.concurrency.status === 'ready'
      ? { concurrency: subjects.concurrency.payload }
      : {}),
    ...(subjects.backpressure.status === 'ready'
      ? { pendingQueue: subjects.backpressure.payload }
      : {}),
    ...(subjects.batch.status === 'ready' ? { batchByPool: subjects.batch.payload.pools } : {}),
    ...(subjects.conservation.status === 'ready'
      ? { conservation: subjects.conservation.payload }
      : {}),
    ...(subjects.kernelInputDistribution.status === 'ready'
      ? { kernelInputDistribution: subjects.kernelInputDistribution.payload }
      : {}),
    ...(subjects.kernelTimeShare.status === 'ready'
      ? { kernelTimeShare: subjects.kernelTimeShare.payload }
      : {}),
  };

  const provenance = descriptor.provenance;
  const sourceKind =
    provenance?.source === 'fixture'
      ? provenance.synthetic
        ? 'synthetic'
        : 'analyzer_fixture'
      : 'analyzer_http';
  const simulationFolder =
    provenance?.source === 'fixture'
      ? (provenance.sourceRun ?? descriptor.runId)
      : descriptor.runId;

  return {
    id: descriptor.runId,
    name: descriptor.displayName ?? descriptor.runId,
    model,
    deployment: descriptor.deployment,
    gpu,
    summary: {
      total_tok_s: rootSummary.totalTokS,
      num_gpus: rootSummary.numGpus,
      requests: rootSummary.requestsFinished,
      ...(rootSummary.requestsTotal === undefined
        ? {}
        : { requests_total: rootSummary.requestsTotal }),
      ttft_p50: slo.ttft.markers.p50,
      tpot_p50: slo.tpot.markers.p50,
      e2e_p50: slo.e2e.markers.p50,
    },
    topology,
    trees,
    payloads,
    workerList,
    gpuTotal,
    source: {
      kind: sourceKind,
      simulationFolder,
      // Artifact provenance says where bytes came from, not whether this UI
      // session reran the simulator. Preserve that distinction explicitly.
      simulationReexecuted: null,
    },
    capabilities: {
      traceOverview: false,
      concurrencyTimeline: subjects.concurrency.status === 'ready',
      workerIterations: false,
      kernelPerformance: false,
      kernelInputDistribution: subjects.kernelInputDistribution.status === 'ready',
      loadImbalance: false,
      perfettoTrace: descriptor.traces.perfetto?.status === 'ready',
    },
  };
}

/** Compatibility assembler for the current synchronous view. It deliberately
 * lives above the repository so transport implementations keep fine-grained,
 * status-preserving reads. Worker trees can become selection-lazy once the
 * cluster breakdown consumes kernelTimeShare directly. */
export async function loadActiveRunData(
  repository: AnalyzerRepository,
  descriptor: RunDescriptor,
): Promise<ActiveRunData> {
  const [rootSummary, topology, subjectPairs] = await Promise.all([
    repository.getRunSummary(descriptor.runId),
    repository.getRunTopology(descriptor.runId),
    Promise.all(
      SUBJECT_NAMES.map(
        async (name) => [name, await repository.getSubject(descriptor.runId, name)] as const,
      ),
    ),
  ]);
  const subjects = Object.fromEntries(subjectPairs) as SubjectResults;
  const roster = requireSameWorkerRoster(descriptor.workers, topology);
  const treePairs = await Promise.all(
    roster.map(
      async (worker) =>
        [
          makeWorkerKey(worker),
          await repository.getWorkerCostTree(descriptor.runId, worker),
        ] as const,
    ),
  );
  const trees = Object.fromEntries(treePairs) as Record<WorkerKey, CostNode>;
  return {
    descriptor,
    subjects,
    run: assembleRun(descriptor, rootSummary, topology, subjects, trees),
  };
}
