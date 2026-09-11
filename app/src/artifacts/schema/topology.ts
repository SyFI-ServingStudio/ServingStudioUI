/**
 * A run's shape, from the two documents that describe it.
 *
 * The analyzer serves `params` — what the run was asked to be — beside
 * `run_meta` — what it turned out to be. They are written at different times by
 * different code, and this module's real work is refusing to hand over a
 * topology when they disagree, because nothing downstream can notice. A pool
 * whose declared replica count is not the number of workers that ran is a page
 * that names workers which do not exist, or omits ones that do, and it renders
 * perfectly either way.
 *
 * Everything here is a pure function of a parsed body, so each rule can be
 * exercised by handing it a literal.
 */
import { z } from 'zod';

import { segmentSchema } from '../../location';
import type { RunTopology, TopologyPool, TopologyWorker } from '../ref';

export const TOPOLOGY_SCHEMA_VERSION = 1;

/**
 * Raised for every way a topology payload can be unreadable.
 *
 * One error for three causes — a schema version this build does not implement,
 * a body that does not parse, and a body that parses and says something
 * impossible — because the caller does the same thing with all three: it tells
 * the reader the topology could not be read, and `issues` says why. A separate
 * class per cause would be three ways to spell one outcome.
 */
export class IncompatibleTopologyError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`topology payload is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'IncompatibleTopologyError';
  }
}

const nonEmpty = z.string().min(1);
const count = z.number().int().nonnegative().safe();

/**
 * Both documents are passed through from the simulator, so both are read
 * loosely: `passthrough` at every level, because a key this build has never
 * heard of is normal and rejecting the body over one would take the whole page
 * down. What is required is only what the cross-checks below need — an address
 * the reader can click has to be backed by something.
 */
const archSchema = z
  .object({
    type: nonEmpty,
  })
  .passthrough();

const groupSchema = z
  .object({
    gpu: nonEmpty,
    replicas: count.positive(),
    arch: archSchema,
    worker: z.object({ type: nonEmpty }).passthrough(),
  })
  .passthrough();

const poolSchema = z
  .object({
    groups: z.array(groupSchema),
    placement: nonEmpty.optional(),
  })
  .passthrough();

const paramsSchema = z
  .object({
    deployment: z.enum(['unified', 'pd', 'afd']),
    pools: z.record(poolSchema),
  })
  .passthrough();

const gpuSchema = z
  .object({
    id: count,
    name: nonEmpty,
    pool_tag: nonEmpty,
  })
  .passthrough();

const metaWorkerSchema = z
  .object({
    worker_id: count,
    pool_tag: nonEmpty,
    gpu_ids: z.array(count),
  })
  .passthrough();

const runMetaSchema = z
  .object({
    gpus: z.array(gpuSchema),
    workers: z.array(metaWorkerSchema),
  })
  .passthrough();

const topologySchema = z
  .object({
    schema_version: z.number(),
    params: paramsSchema,
    run_meta: runMetaSchema,
  })
  .passthrough();

/** The version in the body, before it is known to be one this build reads. */
function topologyVersion(body: unknown): number | undefined {
  const version = (body as { schema_version?: unknown } | null)?.schema_version;
  return typeof version === 'number' ? version : undefined;
}

export function parseTopology(body: unknown): RunTopology {
  const version = topologyVersion(body);
  if (version !== undefined && version !== TOPOLOGY_SCHEMA_VERSION) {
    throw new IncompatibleTopologyError(
      [`schema_version ${version} is not ${TOPOLOGY_SCHEMA_VERSION}`],
      version,
    );
  }
  const parsed = topologySchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleTopologyError(
      parsed.error.issues.map(
        (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
      ),
      version,
    );
  }
  const { params, run_meta: meta } = parsed.data;
  const issues: string[] = [];

  // The whole record, not just the name: the roster also says which pool each
  // GPU belongs to, which is a second and independent statement about placement
  // that has to agree with the workers'. Built by hand rather than from
  // `new Map(...)`, because that quietly keeps the last of two rows sharing an
  // id — and a roster that names one GPU twice has miscounted the machine.
  const roster = new Map<number, z.infer<typeof gpuSchema>>();
  for (const gpu of meta.gpus) {
    if (roster.has(gpu.id)) issues.push(`run_meta.gpus: GPU ${gpu.id} is listed more than once`);
    else roster.set(gpu.id, gpu);
  }

  // Pools come from what actually ran, in the order `run_meta` lists their
  // first worker. Reading them off `params.pools` instead would put a pool on
  // screen that the run never started, and object key order is not a reading
  // order in any case.
  const tags: string[] = [];
  for (const worker of meta.workers) {
    if (!tags.includes(worker.pool_tag)) tags.push(worker.pool_tag);
  }

  // A pool tag is written straight into the address, and `parseLocation` bounds
  // what it will read back. A tag that formats but will not parse gives a map
  // that draws, offers the reader a link, and cannot be reloaded from it — so
  // the refusal happens here, while there is still something to say about why.
  // Worker ids need no such check: they arrive as non-negative integers, and
  // every one of those is addressable.
  for (const tag of tags) {
    if (!segmentSchema.safeParse({ at: 'pool', role: tag }).success) {
      issues.push(`run_meta.workers: pool tag "${clip(tag)}" cannot be put in an address`);
    }
  }

  // A worker is addressed by its pool and its id, so two rows sharing that pair
  // are two different workers behind one address: every panel the reader opens
  // below the map would answer for the first, and the second is unreachable.
  // The replica count does not catch this — a pool declaring two replicas and
  // listing worker 0 twice has the right number of rows.
  const identities = new Set<string>();
  for (const worker of meta.workers) {
    const identity = `${worker.pool_tag}/${worker.worker_id}`;
    if (identities.has(identity)) {
      issues.push(
        `run_meta.workers: pool "${worker.pool_tag}" lists worker ${worker.worker_id} more than once`,
      );
    }
    identities.add(identity);
  }

  const pools = tags.flatMap((tag): TopologyPool[] => {
    const pool = params.pools[tag];
    if (pool === undefined) {
      issues.push(`run_meta names pool "${tag}", which params does not declare`);
      return [];
    }
    if (pool.groups.length !== 1) {
      // `run_meta` carries no group identity, so with two groups there is no
      // way to say which workers belong to which — and assigning them by array
      // position is a guess that looks like a fact.
      issues.push(
        `params.pools.${tag}.groups: run_meta cannot identify ${pool.groups.length} groups`,
      );
      return [];
    }
    const group = pool.groups[0];
    const workers = meta.workers.filter((worker) => worker.pool_tag === tag);
    if (workers.length !== group.replicas) {
      issues.push(
        `params.pools.${tag}.groups.0.replicas: declares ${group.replicas}, but run_meta has ${workers.length} workers`,
      );
      return [];
    }
    const widths = new Set(workers.map((worker) => worker.gpu_ids.length));
    if (widths.size !== 1) {
      issues.push(`run_meta.workers: pool "${tag}" workers do not have a uniform GPU count`);
      return [];
    }
    for (const worker of workers) {
      for (const id of worker.gpu_ids) {
        const gpu = roster.get(id);
        if (gpu === undefined) {
          issues.push(`run_meta.workers: GPU ${id} in pool "${tag}" is not in the GPU roster`);
          continue;
        }
        if (gpu.name !== group.gpu) {
          issues.push(
            `run_meta GPU ${id}: model ${gpu.name} disagrees with params.pools.${tag} ${group.gpu}`,
          );
        }
        if (gpu.pool_tag !== tag) {
          // Both documents place this GPU, and they disagree. Whichever is
          // right, a card that added up its GPUs from one of them is counting
          // hardware that was somewhere else.
          issues.push(
            `run_meta GPU ${id}: the roster puts it in pool "${gpu.pool_tag}", but worker ${worker.worker_id} of "${tag}" runs on it`,
          );
        }
      }
    }
    return [
      {
        tag,
        placement: pool.placement ?? 'unspecified',
        group: {
          gpu: group.gpu,
          archType: group.arch.type,
          workerType: group.worker.type,
          replicas: group.replicas,
          gpusPerReplica: [...widths][0],
          params: archRest(group.arch),
          workers: workers.map((worker): TopologyWorker => ({
            id: String(worker.worker_id),
            gpus: [...worker.gpu_ids],
          })),
        },
      },
    ];
  });

  // Every GPU the roster lists is placed on exactly one worker, and no worker
  // claims one twice. Without this a run can lose a GPU between the two
  // documents and the map simply draws one fewer.
  const placed = pools.flatMap((pool) => pool.group.workers.flatMap((worker) => worker.gpus));
  if (new Set(placed).size !== placed.length) {
    issues.push('run_meta.workers: a GPU is placed on more than one worker');
  }
  if (issues.length === 0 && new Set(placed).size !== roster.size) {
    issues.push(
      `run_meta: ${roster.size} GPUs in the roster, ${new Set(placed).size} placed on workers`,
    );
  }
  if (issues.length > 0) throw new IncompatibleTopologyError(issues, version);
  return { pools, gpus: new Set(placed).size, deployment: params.deployment };
}

/** Enough of an over-long token to recognise it by, without printing all of it. */
function clip(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}

/**
 * Everything the run declared about the architecture except its name.
 *
 * `type` is lifted out because it is the one key with a fixed meaning; the rest
 * is passed through untouched, so a parameter this build has never heard of
 * survives to the panel rather than being dropped by a schema that predates it.
 */
function archRest(arch: z.infer<typeof archSchema>): Readonly<Record<string, unknown>> {
  const { type: _name, ...rest } = arch;
  return rest;
}
