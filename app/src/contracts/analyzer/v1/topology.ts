import type { Deployment } from '../../../domain/deployment';
import type { Arch, Group, Topology, WorkerCfg } from '../../../domain/run';
import { makeWorkerKey, makeWorkerRef } from '../../../domain/worker';
import {
  parseAnalyzerV1Params,
  type AnalyzerV1ArchParams,
  type AnalyzerV1GroupParams,
  type AnalyzerV1Params,
  type AnalyzerV1WorkerParams,
} from './params';
import { parseAnalyzerV1RunMeta, type AnalyzerV1RunMeta } from './runMeta';

interface ResolvedWorker {
  gpuIds: number[];
  numericPool: number;
  poolTag: string;
  workerId: number;
}

function sameNumberSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function numericValue(value: string | number | boolean): number | string {
  return typeof value === 'boolean' ? String(value) : value;
}

const ARCH_PARAM_ALIASES: Readonly<Record<string, string>> = {
  tp_size: 'attn_tp',
  attn_tp_size: 'attn_tp',
  ep_size: 'ep',
  hp_size: 'hp',
  nvl_num_gpu: 'nvl',
};

function archFromParams(rawArch: AnalyzerV1ArchParams): Arch {
  const params: Record<string, number | string> = {};
  for (const [wireName, value] of Object.entries(rawArch)) {
    if (wireName === 'type' || wireName === 'model_config') continue;
    const domainName = ARCH_PARAM_ALIASES[wireName] ?? wireName;
    const domainValue = numericValue(value);
    const existing = params[domainName];
    if (existing !== undefined && existing !== domainValue) {
      throw new AnalyzerV1TopologyError([
        `arch.${domainName}: conflicting values from analyzer params aliases`,
      ]);
    }
    params[domainName] = domainValue;
  }
  return { type: rawArch.type, model: rawArch.model_config, params };
}

function workerFromParams(rawWorker: AnalyzerV1WorkerParams): WorkerCfg {
  return {
    type: rawWorker.type,
    ...(rawWorker.attn_gpu_memory_gb === undefined ? {} : { memGb: rawWorker.attn_gpu_memory_gb }),
    ...(rawWorker.gpu_time_multiplier === undefined ? {} : { mult: rawWorker.gpu_time_multiplier }),
    ...(rawWorker.max_batch_tokens === undefined
      ? {}
      : { maxBatchTokens: rawWorker.max_batch_tokens }),
  };
}

function groupsForPool(params: AnalyzerV1Params, poolTag: string): AnalyzerV1GroupParams[] {
  const pool = (params.pools as Record<string, { groups: AnalyzerV1GroupParams[] }>)[poolTag];
  if (pool === undefined) throw new AnalyzerV1TopologyError([`params.pools.${poolTag}: missing`]);
  return pool.groups;
}

function placementForPool(params: AnalyzerV1Params, poolTag: string): string {
  const pool = (params.pools as Record<string, { placement: string }>)[poolTag];
  if (pool === undefined) throw new AnalyzerV1TopologyError([`params.pools.${poolTag}: missing`]);
  return pool.placement;
}

function resolveWorkers(runMeta: AnalyzerV1RunMeta): ResolvedWorker[] {
  // run_meta v4 stamps an authoritative pool_tag on every worker; read it directly.
  // GPU ownership + full-roster coverage are already enforced by parseAnalyzerV1RunMeta.
  const resolved = runMeta.workers.map((worker, workerIndex) => {
    const poolTag = 'pool_tag' in worker ? worker.pool_tag : null;
    if (poolTag === null) {
      throw new AnalyzerV1TopologyError([
        `run_meta.workers.${workerIndex}: missing pool_tag — topology requires run_meta v4`,
      ]);
    }
    return {
      gpuIds: [...worker.gpu_ids],
      numericPool: worker.pool,
      poolTag,
      workerId: worker.worker_id,
    };
  });

  const workerKeys = resolved.map((worker) =>
    makeWorkerKey(makeWorkerRef(worker.poolTag, worker.workerId)),
  );
  if (new Set(workerKeys).size !== workerKeys.length) {
    throw new AnalyzerV1TopologyError(['run_meta.workers: duplicate composite worker identity']);
  }
  return resolved;
}

/** Ordered `(numericPool, poolTag)` pairs from the resolved workers — run_meta's
 * own pool identity, replacing the hardcoded deployment role table. */
function poolsFromWorkers(workers: ResolvedWorker[]): Array<[number, string]> {
  const poolByNumeric = new Map<number, string>();
  for (const worker of workers) {
    const existing = poolByNumeric.get(worker.numericPool);
    if (existing !== undefined && existing !== worker.poolTag) {
      throw new AnalyzerV1TopologyError([
        `run_meta.workers: numeric pool ${worker.numericPool} carries conflicting tags ${existing} and ${worker.poolTag}`,
      ]);
    }
    poolByNumeric.set(worker.numericPool, worker.poolTag);
  }
  return [...poolByNumeric.entries()].sort(([left], [right]) => left - right);
}

function topologyFromParsed(params: AnalyzerV1Params, runMeta: AnalyzerV1RunMeta): Topology {
  const resolvedWorkers = resolveWorkers(runMeta);
  const gpuById = new Map(runMeta.gpus.map((gpu) => [gpu.id, gpu]));

  const pools = poolsFromWorkers(resolvedWorkers).map(([numericPool, poolTag]) => {
    const groupParams = groupsForPool(params, poolTag);
    // The simulator currently rejects heterogeneous pool configs at build time,
    // and run_meta carries no group identity. Reject instead of assigning workers
    // to a group by array position.
    if (groupParams.length !== 1) {
      throw new AnalyzerV1TopologyError([
        `params.pools.${poolTag}.groups: run_meta cannot identify ${groupParams.length} groups`,
      ]);
    }
    const rawGroup = groupParams[0];
    const poolWorkers = resolvedWorkers.filter((worker) => worker.numericPool === numericPool);
    if (poolWorkers.length !== rawGroup.replicas) {
      throw new AnalyzerV1TopologyError([
        `params.pools.${poolTag}.groups.0.replicas: declares ${rawGroup.replicas}, but run_meta has ${poolWorkers.length} workers`,
      ]);
    }

    const gpuCounts = new Set(poolWorkers.map((worker) => worker.gpuIds.length));
    if (gpuCounts.size !== 1) {
      throw new AnalyzerV1TopologyError([
        `run_meta.workers: ${poolTag} workers do not have a uniform GPU count`,
      ]);
    }
    poolWorkers.forEach((worker) => {
      worker.gpuIds.forEach((gpuId) => {
        const gpu = gpuById.get(gpuId);
        if (gpu === undefined || gpu.name !== rawGroup.gpu) {
          throw new AnalyzerV1TopologyError([
            `run_meta GPU ${gpuId}: model ${gpu?.name ?? '<missing>'} disagrees with params ${rawGroup.gpu}`,
          ]);
        }
      });
    });

    const gpusPerReplica = [...gpuCounts][0];
    const group: Group = {
      gpu: rawGroup.gpu,
      replicas: rawGroup.replicas,
      gpusPerReplica,
      numGpus: poolWorkers.reduce((total, worker) => total + worker.gpuIds.length, 0),
      arch: archFromParams(rawGroup.arch),
      worker: workerFromParams(rawGroup.worker),
      workers: poolWorkers.map((worker) => ({
        id: String(worker.workerId),
        gpus: [...worker.gpuIds],
      })),
    };
    return {
      role: poolTag,
      placement: placementForPool(params, poolTag),
      groups: [group],
    };
  });

  const placedGpuIds = pools.flatMap((pool) =>
    pool.groups.flatMap((group) => group.workers.flatMap((worker) => worker.gpus)),
  );
  if (
    !sameNumberSet(
      placedGpuIds,
      runMeta.gpus.map((gpu) => gpu.id),
    )
  ) {
    throw new AnalyzerV1TopologyError([
      'topology workers do not preserve the run_meta GPU roster exactly',
    ]);
  }
  return { pools };
}

export class AnalyzerV1TopologyError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid analyzer-v1 topology:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1TopologyError';
    this.issues = issues;
  }
}

/** Decode the two authoritative topology inputs and cross-check their worker,
 * pool and GPU facts before exposing a domain Topology. */
export function parseAnalyzerV1Topology(
  paramsInput: unknown,
  runMetaInput: unknown,
  expectedDeployment?: Deployment,
): Topology {
  const params = parseAnalyzerV1Params(paramsInput);
  if (expectedDeployment !== undefined && params.deployment !== expectedDeployment) {
    throw new AnalyzerV1TopologyError([
      `params.deployment: ${params.deployment} disagrees with descriptor ${expectedDeployment}`,
    ]);
  }
  return topologyFromParsed(params, parseAnalyzerV1RunMeta(runMetaInput));
}
