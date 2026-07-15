import type { RunDescriptor, RunSummaryArtifact } from '../domain/artifacts';
import type { Run, Topology, WorkerRow } from '../domain/run';
import { makeWorkerKey, makeWorkerRef, type WorkerRef } from '../domain/worker';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';

export interface ActiveRunCoreData {
  descriptor: RunDescriptor;
  run: Run;
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

function buildWorkerRows(topology: Topology): WorkerRow[] {
  return topology.pools.flatMap((pool) =>
    pool.groups.flatMap((group) =>
      group.workers.map((worker) => {
        const ref = makeWorkerRef(pool.role, worker.id);
        const key = makeWorkerKey(ref);
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
        };
      }),
    ),
  );
}

/** Pure core assembly. Only summary/topology inconsistencies can reject the
 * basic run; optional analyzer subjects are attached in a second projection. */
export function assembleActiveRunCore(
  descriptor: RunDescriptor,
  rootSummary: RunSummaryArtifact,
  topology: Topology,
): ActiveRunCoreData {
  requireSameWorkerRoster(descriptor.workers, topology);
  const workerList = buildWorkerRows(topology);
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
      : (descriptor.displayName ?? descriptor.runId);

  return {
    descriptor,
    run: {
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
      },
      topology,
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
        workerIterations: false,
        kernelPerformance: false,
        loadImbalance: false,
        perfettoTrace: descriptor.traces.perfetto?.status === 'ready',
      },
    },
  };
}

/** Load only bounded core artifacts. Worker details and optional subjects each
 * have their own selection/version-scoped query. */
export async function loadActiveRunCore(
  repository: AnalyzerRepository,
  descriptor: RunDescriptor,
): Promise<ActiveRunCoreData> {
  const [rootSummary, topology] = await Promise.all([
    repository.getRunSummary(descriptor.runId),
    repository.getRunTopology(descriptor.runId),
  ]);
  return assembleActiveRunCore(descriptor, rootSummary, topology);
}
