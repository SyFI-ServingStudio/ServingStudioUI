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

const POOL_ROLES = {
  unified: ['main'],
  pd: ['prefill', 'decode'],
  afd: ['attn', 'ffn'],
} as const;

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

function resolveWorkers(params: AnalyzerV1Params, runMeta: AnalyzerV1RunMeta): ResolvedWorker[] {
  const poolRoles = POOL_ROLES[params.deployment];
  const gpuById = new Map(runMeta.gpus.map((gpu) => [gpu.id, gpu]));
  const commTagsByNumericWorker = new Map<string, Set<string>>();

  if ('comm_groups' in runMeta) {
    runMeta.comm_groups.forEach((group, groupIndex) => {
      const gpuOwners = group.gpu_ids.map((gpuId) => gpuById.get(gpuId));
      const missingGpu = gpuOwners.findIndex((gpu) => gpu === undefined);
      if (missingGpu !== -1) {
        throw new AnalyzerV1TopologyError([
          `run_meta.comm_groups.${groupIndex}.gpu_ids: references unknown GPU ${group.gpu_ids[missingGpu]}`,
        ]);
      }
      const owners = gpuOwners as Array<NonNullable<(typeof gpuOwners)[number]>>;
      const numericPools = new Set(owners.map((gpu) => gpu.pool));
      const workerIds = new Set(owners.map((gpu) => gpu.worker_id));
      if (numericPools.size !== 1 || workerIds.size !== 1) {
        throw new AnalyzerV1TopologyError([
          `run_meta.comm_groups.${groupIndex}: spans more than one worker`,
        ]);
      }
      const numericPool = owners[0].pool;
      const workerId = owners[0].worker_id;
      if (workerId !== group.owner_worker_id) {
        throw new AnalyzerV1TopologyError([
          `run_meta.comm_groups.${groupIndex}.owner_worker_id: disagrees with GPU ownership`,
        ]);
      }
      const expectedPoolTag = poolRoles[numericPool];
      if (expectedPoolTag === undefined) {
        throw new AnalyzerV1TopologyError([
          `run_meta.comm_groups.${groupIndex}: references unknown numeric pool ${numericPool}`,
        ]);
      }
      if (group.owner_pool !== expectedPoolTag) {
        throw new AnalyzerV1TopologyError([
          `run_meta.comm_groups.${groupIndex}.owner_pool: ${group.owner_pool} disagrees with deployment pool ${expectedPoolTag}`,
        ]);
      }
      const numericWorkerKey = `${numericPool}/${workerId}`;
      const tags = commTagsByNumericWorker.get(numericWorkerKey) ?? new Set<string>();
      tags.add(group.owner_pool);
      commTagsByNumericWorker.set(numericWorkerKey, tags);
    });
  }

  const resolved = runMeta.workers.map((worker, workerIndex) => {
    const expectedPoolTag = poolRoles[worker.pool];
    if (expectedPoolTag === undefined) {
      throw new AnalyzerV1TopologyError([
        `run_meta.workers.${workerIndex}.pool: unknown numeric pool ${worker.pool} for ${params.deployment}`,
      ]);
    }
    const numericWorkerKey = `${worker.pool}/${worker.worker_id}`;
    const commTags = commTagsByNumericWorker.get(numericWorkerKey) ?? new Set<string>();
    if (commTags.size > 1) {
      throw new AnalyzerV1TopologyError([
        `run_meta.workers.${workerIndex}: comm groups disagree on pool tag`,
      ]);
    }
    const directPoolTag = 'pool_tag' in worker ? worker.pool_tag : null;
    const commPoolTag = [...commTags][0];
    for (const observedPoolTag of [directPoolTag, commPoolTag]) {
      if (
        observedPoolTag !== null &&
        observedPoolTag !== undefined &&
        observedPoolTag !== expectedPoolTag
      ) {
        throw new AnalyzerV1TopologyError([
          `run_meta.workers.${workerIndex}: pool tag ${observedPoolTag} disagrees with deployment pool ${expectedPoolTag}`,
        ]);
      }
    }
    return {
      gpuIds: [...worker.gpu_ids],
      numericPool: worker.pool,
      poolTag: expectedPoolTag,
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

function topologyFromParsed(params: AnalyzerV1Params, runMeta: AnalyzerV1RunMeta): Topology {
  const resolvedWorkers = resolveWorkers(params, runMeta);
  const gpuById = new Map(runMeta.gpus.map((gpu) => [gpu.id, gpu]));
  const roles = POOL_ROLES[params.deployment];

  const pools = roles.map((poolTag, numericPool) => {
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
