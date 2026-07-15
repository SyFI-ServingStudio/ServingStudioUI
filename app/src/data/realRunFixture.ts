import { z } from 'zod';
import summaryJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/summary.json';
import paramsJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import runMetaJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
import sloJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/slo_general_cdf.json';
import throughputJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/throughput_segments.json';
import utilizationJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/utilization_series.json';
import kvJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/kv_occupancy_series.json';
import kernelTimeShareJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/kernel_time_share_composition.json';
import batchJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/batch_scatter.json';
import conservationJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/workload_conservation_checks.json';
import { decodeAnalyzerV1KernelTimeSharePayload } from '../contracts/analyzer/v1/kernelTimeShare';
import type {
  Arch,
  BatchSeries,
  CheckStatus,
  Conservation,
  Group,
  KvSeries,
  Run,
  Slo,
  Throughput,
  Topology,
  UtilSeries,
  WorkerCfg,
  WorkerRow,
} from '../domain/run';
import { makeWorkerKey, makeWorkerRef, type WorkerKey } from '../domain/worker';

const RUN_FOLDER = '20260715_1_afd_ui_reanalysis';
const ARTIFACT_LOG_DIR = `logs/${RUN_FOLDER}`;
const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const nonEmptyString = z.string().min(1);
const scalar = z.union([z.string(), finiteNumber, z.boolean()]);

const summarySchema = z.object({
  num_gpus: positiveInteger,
  requests_finished: nonNegativeInteger,
  requests_total: nonNegativeInteger,
  total_tok_s: finiteNumber.nonnegative(),
});

const archSchema = z
  .object({
    type: nonEmptyString,
    model_config: nonEmptyString,
    attn_tp_size: positiveInteger,
    ep_size: positiveInteger.optional(),
    nvl_num_gpu: positiveInteger.optional(),
    routing: nonEmptyString.optional(),
    fp8: z.boolean(),
  })
  .catchall(scalar);

const workerConfigSchema = z
  .object({
    type: nonEmptyString,
    attn_gpu_memory_gb: finiteNumber.positive().optional(),
  })
  .catchall(scalar);

const paramsSchema = z.object({
  deployment: z.literal('afd'),
  pools: z.record(
    nonEmptyString,
    z.object({
      placement: nonEmptyString,
      groups: z
        .array(
          z.object({
            arch: archSchema,
            gpu: nonEmptyString,
            replicas: positiveInteger,
            worker: workerConfigSchema,
          }),
        )
        .min(1),
    }),
  ),
});

const metaWorkerSchema = z.object({
  gpu_ids: z.array(nonNegativeInteger).min(1),
  pool: nonNegativeInteger,
  pool_tag: nonEmptyString.nullable(),
  worker_id: nonNegativeInteger,
});

const runMetaSchema = z.object({
  comm_groups: z
    .array(
      z.object({
        gpu_ids: z.array(nonNegativeInteger).min(1),
        owner_pool: nonEmptyString,
        owner_worker_id: nonNegativeInteger,
      }),
    )
    .min(1),
  gpus: z
    .array(
      z.object({
        id: nonNegativeInteger,
        name: nonEmptyString,
        pool: nonNegativeInteger,
        worker_id: nonNegativeInteger,
      }),
    )
    .min(1),
  num_gpus: positiveInteger,
  schema_version: z.literal(3),
  workers: z.array(metaWorkerSchema).min(1),
});

const sloSeriesSchema = z.object({
  key: nonEmptyString,
  label: nonEmptyString,
  markers: z.object({ p50: finiteNumber, p90: finiteNumber, p99: finiteNumber }),
  n: nonNegativeInteger,
  unit: nonEmptyString,
  x: z.array(finiteNumber).min(1),
  y_pct: z.array(finiteNumber).min(1),
});

const sloSchema = z.object({
  meta: z.object({ log_dir: nonEmptyString }),
  schema_version: z.literal(1),
  series: z.array(sloSeriesSchema).min(1),
});

const throughputSchema = z.object({
  meta: z.object({
    gpu_name: nonEmptyString,
    log_dir: nonEmptyString,
    num_gpus: positiveInteger,
    unit: z.literal('tokens/s per GPU'),
  }),
  series: z
    .array(
      z.object({
        key: nonEmptyString,
        label: nonEmptyString,
        per_gpu: z.array(finiteNumber).min(1),
      }),
    )
    .min(1),
  schema_version: z.literal(1),
  t_end_ms: z.array(finiteNumber).min(1),
  t_start_ms: z.array(finiteNumber).min(1),
});

const utilizationSchema = z.object({
  meta: z.object({
    log_dir: nonEmptyString,
    unit: z.literal('fraction of pool workers busy (0-1)'),
  }),
  series: z
    .array(
      z.object({
        key: nonEmptyString,
        label: nonEmptyString,
        pool_tag: nonEmptyString,
        util: z.array(finiteNumber).min(1),
      }),
    )
    .min(1),
  schema_version: z.literal(1),
  t_end_ms: z.array(finiteNumber).min(1),
  t_start_ms: z.array(finiteNumber).min(1),
});

const kvSchema = z.object({
  meta: z.object({
    has_capacity: z.literal(true),
    log_dir: nonEmptyString,
    unit: z.literal('KV tokens (per shard); fraction = tokens / capacity_tokens'),
  }),
  series: z
    .array(
      z.object({
        active: z.object({ mean: z.array(finiteNumber).min(1) }),
        capacity_tokens: finiteNumber.positive(),
        key: nonEmptyString,
        label: nonEmptyString,
        pool_tag: nonEmptyString,
      }),
    )
    .min(1),
  schema_version: z.literal(1),
  t_end_ms: z.array(finiteNumber).min(1),
  t_start_ms: z.array(finiteNumber).min(1),
});

const batchSchema = z.object({
  available: z.literal(true),
  meta: z.object({ log_dir: nonEmptyString }),
  pools: z
    .array(
      z.object({
        plotted_points: positiveInteger,
        pool: nonEmptyString,
        series: z
          .array(
            z.object({
              key: nonEmptyString,
              values: z.array(finiteNumber).min(1),
            }),
          )
          .min(1),
        time_ms: z.array(finiteNumber).min(1),
      }),
    )
    .min(1),
  schema_version: z.literal(1),
});

const conservationSchema = z.object({
  checks: z.array(
    z.object({
      actual: finiteNumber,
      delta_pct: finiteNumber,
      description: nonEmptyString,
      expected: finiteNumber,
      name: nonEmptyString,
      status: z.enum(['OK', 'WARN', 'FAIL']),
    }),
  ),
  meta: z.object({
    all_ok: z.boolean(),
    available: z.literal(true),
    log_dir: nonEmptyString,
  }),
  schema_version: z.literal(1),
});

function parseFixture<Schema extends z.ZodTypeAny>(
  label: string,
  schema: Schema,
  value: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`[realRunFixture] ${label} is incompatible: ${details}`);
  }
  return result.data;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[realRunFixture] ${message}`);
}

function checkArtifactFolder(label: string, logDir: string): void {
  invariant(
    logDir === ARTIFACT_LOG_DIR,
    `${label} belongs to ${logDir}, expected ${ARTIFACT_LOG_DIR}`,
  );
}

function requireUniqueByKey<T extends { key: string }>(items: T[], key: string, label: string): T {
  const matches = items.filter((item) => item.key === key);
  invariant(
    matches.length === 1,
    `${label} must contain exactly one ${key} series, found ${matches.length}`,
  );
  return matches[0];
}

function checkParallelLengths(label: string, expectedLength: number, arrays: number[][]): void {
  arrays.forEach((values, index) => {
    invariant(
      values.length === expectedLength,
      `${label} array ${index} has ${values.length} points, expected ${expectedLength}`,
    );
  });
}

function sameNumberSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

const rawSummary = parseFixture('summary.json', summarySchema, summaryJson);
const rawParams = parseFixture('raw/params.json', paramsSchema, paramsJson);
const rawRunMeta = parseFixture('raw/run_meta.json', runMetaSchema, runMetaJson);
const rawSlo = parseFixture('payloads/slo_general_cdf.json', sloSchema, sloJson);
const rawThroughput = parseFixture(
  'payloads/throughput_segments.json',
  throughputSchema,
  throughputJson,
);
const rawUtilization = parseFixture(
  'payloads/utilization_series.json',
  utilizationSchema,
  utilizationJson,
);
const rawKv = parseFixture('payloads/kv_occupancy_series.json', kvSchema, kvJson);
const kernelTimeShareResult = decodeAnalyzerV1KernelTimeSharePayload(kernelTimeShareJson, {
  expectedLogDir: ARTIFACT_LOG_DIR,
});
if (kernelTimeShareResult.status !== 'ready') {
  invariant(
    false,
    `payloads/kernel_time_share_composition.json is ${kernelTimeShareResult.status}: ${kernelTimeShareResult.reason}`,
  );
}
const kernelTimeShare = kernelTimeShareResult.payload;
const rawBatch = parseFixture('payloads/batch_scatter.json', batchSchema, batchJson);
const rawConservation = parseFixture(
  'payloads/workload_conservation_checks.json',
  conservationSchema,
  conservationJson,
);

[
  ['SLO', rawSlo.meta.log_dir],
  ['throughput', rawThroughput.meta.log_dir],
  ['utilization', rawUtilization.meta.log_dir],
  ['KV', rawKv.meta.log_dir],
  ['batch', rawBatch.meta.log_dir],
  ['conservation', rawConservation.meta.log_dir],
].forEach(([label, logDir]) => checkArtifactFolder(label, logDir));

invariant(rawRunMeta.num_gpus === rawSummary.num_gpus, 'summary and run_meta disagree on num_gpus');
invariant(
  rawRunMeta.gpus.length === rawRunMeta.num_gpus,
  'run_meta.gpus length does not match num_gpus',
);
invariant(
  rawThroughput.meta.num_gpus === rawRunMeta.num_gpus,
  'throughput and run_meta disagree on num_gpus',
);
invariant(
  kernelTimeShare.workers.length === rawRunMeta.workers.length,
  'kernel time share and run_meta disagree on worker count',
);
invariant(
  rawSummary.requests_finished <= rawSummary.requests_total,
  'finished requests exceed offered requests',
);

const gpuIds = new Set(rawRunMeta.gpus.map((gpu) => gpu.id));
invariant(gpuIds.size === rawRunMeta.gpus.length, 'run_meta contains duplicate GPU ids');
const gpuNames = new Set(rawRunMeta.gpus.map((gpu) => gpu.name));
invariant(
  gpuNames.size === 1,
  `Run domain supports one GPU model, found ${[...gpuNames].join(', ')}`,
);
const gpuName = [...gpuNames][0];
invariant(rawThroughput.meta.gpu_name === gpuName, 'throughput GPU model disagrees with run_meta');

interface ResolvedMetaWorker {
  gpuIds: number[];
  key: WorkerKey;
  numericPool: number;
  poolTag: string;
  workerId: number;
}

const resolvedMetaWorkers: ResolvedMetaWorker[] = rawRunMeta.workers.map((worker) => {
  const matchingCommGroups = rawRunMeta.comm_groups.filter(
    (group) =>
      group.owner_worker_id === worker.worker_id && sameNumberSet(group.gpu_ids, worker.gpu_ids),
  );
  invariant(
    matchingCommGroups.length === 1,
    `worker pool=${worker.pool} id=${worker.worker_id} has ${matchingCommGroups.length} matching comm groups`,
  );
  const commPoolTag = matchingCommGroups[0].owner_pool;
  invariant(
    worker.pool_tag === null || worker.pool_tag === commPoolTag,
    `worker ${worker.worker_id} pool_tag ${worker.pool_tag} disagrees with comm owner ${commPoolTag}`,
  );
  const poolTag = worker.pool_tag ?? commPoolTag;
  invariant(rawParams.pools[poolTag] !== undefined, `worker references unknown pool ${poolTag}`);
  const ref = makeWorkerRef(poolTag, worker.worker_id);
  return {
    gpuIds: [...worker.gpu_ids],
    key: makeWorkerKey(ref),
    numericPool: worker.pool,
    poolTag,
    workerId: worker.worker_id,
  };
});

invariant(
  new Set(resolvedMetaWorkers.map((worker) => worker.key)).size === resolvedMetaWorkers.length,
  'run_meta contains duplicate composite worker identities',
);
const placedGpuIds = resolvedMetaWorkers.flatMap((worker) => worker.gpuIds);
invariant(
  placedGpuIds.length === rawRunMeta.num_gpus,
  'worker placement does not cover exactly num_gpus entries',
);
invariant(
  new Set(placedGpuIds).size === rawRunMeta.num_gpus,
  'worker placement contains duplicated or missing GPUs',
);

function archFromParams(rawArch: z.infer<typeof archSchema>): Arch {
  const normalizedParallelism: Record<string, number | string> = {
    attn_tp: rawArch.attn_tp_size,
    fp8: String(rawArch.fp8),
  };
  if (rawArch.ep_size !== undefined) normalizedParallelism.ep = rawArch.ep_size;
  if (rawArch.nvl_num_gpu !== undefined) normalizedParallelism.nvl = rawArch.nvl_num_gpu;
  if (rawArch.routing !== undefined) normalizedParallelism.routing = rawArch.routing;
  return {
    type: rawArch.type,
    model: rawArch.model_config,
    params: normalizedParallelism,
  };
}

function workerConfigFromParams(rawWorker: z.infer<typeof workerConfigSchema>): WorkerCfg {
  return rawWorker.attn_gpu_memory_gb === undefined
    ? { type: rawWorker.type }
    : { type: rawWorker.type, memGb: rawWorker.attn_gpu_memory_gb };
}

function validateGpuPlacement(worker: ResolvedMetaWorker, expectedGpuName: string): void {
  worker.gpuIds.forEach((gpuId) => {
    const matchingGpus = rawRunMeta.gpus.filter((gpu) => gpu.id === gpuId);
    invariant(matchingGpus.length === 1, `worker ${worker.key} references missing GPU ${gpuId}`);
    const gpu = matchingGpus[0];
    invariant(
      gpu.name === expectedGpuName,
      `GPU ${gpuId} model ${gpu.name} disagrees with ${expectedGpuName}`,
    );
    invariant(
      gpu.pool === worker.numericPool,
      `GPU ${gpuId} pool disagrees with worker ${worker.key}`,
    );
    invariant(
      gpu.worker_id === worker.workerId,
      `GPU ${gpuId} owner disagrees with worker ${worker.key}`,
    );
  });
}

const topology: Topology = {
  pools: Object.entries(rawParams.pools).map(([poolTag, poolParams]) => {
    // run_meta v3 does not identify an intra-pool group, so this adapter fails
    // rather than guessing if a future fixture introduces multiple groups.
    invariant(
      poolParams.groups.length === 1,
      `${poolTag} has multiple groups but run_meta has no group identity`,
    );
    const groupParams = poolParams.groups[0];
    const poolWorkers = resolvedMetaWorkers.filter((worker) => worker.poolTag === poolTag);
    invariant(
      poolWorkers.length === groupParams.replicas,
      `${poolTag} replicas disagree with run_meta workers`,
    );
    poolWorkers.forEach((worker) => validateGpuPlacement(worker, groupParams.gpu));
    const workerGpuCounts = new Set(poolWorkers.map((worker) => worker.gpuIds.length));
    invariant(workerGpuCounts.size === 1, `${poolTag} workers do not have a uniform GPU count`);
    const gpusPerReplica = [...workerGpuCounts][0];
    const group: Group = {
      arch: archFromParams(groupParams.arch),
      gpu: groupParams.gpu,
      gpusPerReplica,
      numGpus: poolWorkers.reduce((total, worker) => total + worker.gpuIds.length, 0),
      replicas: groupParams.replicas,
      worker: workerConfigFromParams(groupParams.worker),
      workers: poolWorkers.map((worker) => ({
        id: String(worker.workerId),
        gpus: [...worker.gpuIds],
      })),
    };
    return { role: poolTag, placement: poolParams.placement, groups: [group] };
  }),
};

const topologyGpuTotal = topology.pools.reduce(
  (poolTotal, pool) =>
    poolTotal + pool.groups.reduce((groupTotal, group) => groupTotal + group.numGpus, 0),
  0,
);
invariant(topologyGpuTotal === rawRunMeta.num_gpus, 'topology GPU total does not match run_meta');

const kernelTimeShareWorkerKeys = new Set(kernelTimeShare.workers.map((worker) => worker.key));
invariant(
  kernelTimeShareWorkerKeys.size === resolvedMetaWorkers.length,
  'kernel time share worker set is incomplete',
);
resolvedMetaWorkers.forEach((worker) =>
  invariant(
    kernelTimeShareWorkerKeys.has(worker.key),
    `missing kernel composition for ${worker.key}`,
  ),
);

const workerList: WorkerRow[] = topology.pools.flatMap((pool) =>
  pool.groups.flatMap((group) =>
    group.workers.map((worker) => {
      const ref = makeWorkerRef(pool.role, worker.id);
      const key = makeWorkerKey(ref);
      return {
        arch: group.arch,
        archType: group.arch.type,
        dp: null,
        gpu: group.gpu,
        gpuCount: worker.gpus.length,
        gpus: [...worker.gpus],
        id: worker.id,
        key,
        pool: pool.role,
        ref,
        worker: group.worker,
        workerType: group.worker.type,
      };
    }),
  ),
);

function adaptSlo(): Slo {
  const ttft = requireUniqueByKey(rawSlo.series, 'ttft', 'SLO');
  const tpot = requireUniqueByKey(rawSlo.series, 'tpot', 'SLO');
  const e2e = requireUniqueByKey(rawSlo.series, 'e2e', 'SLO');
  invariant(ttft.unit === 'ms', `TTFT unit is ${ttft.unit}, expected ms`);
  invariant(tpot.unit === 'ms/token', `TPOT unit is ${tpot.unit}, expected ms/token`);
  invariant(e2e.unit === 'ms', `E2E unit is ${e2e.unit}, expected ms`);
  [ttft, tpot, e2e].forEach((series) => {
    invariant(
      series.n === rawSummary.requests_finished,
      `${series.key} sample count disagrees with finished requests`,
    );
    checkParallelLengths(`${series.key} CDF`, series.x.length, [series.y_pct]);
  });
  const adapt = (series: typeof ttft) => ({
    label: series.label,
    markers: { ...series.markers },
    unit: series.unit,
    x: [...series.x],
    y_pct: [...series.y_pct],
  });
  return { ttft: adapt(ttft), tpot: adapt(tpot), e2e: adapt(e2e) };
}

function adaptThroughput(): Throughput {
  const pointCount = rawThroughput.t_start_ms.length;
  checkParallelLengths('throughput bins', pointCount, [rawThroughput.t_end_ms]);
  const total = requireUniqueByKey(rawThroughput.series, 'total', 'throughput');
  const prefill = requireUniqueByKey(rawThroughput.series, 'prefill', 'throughput');
  const decode = requireUniqueByKey(rawThroughput.series, 'decode', 'throughput');
  checkParallelLengths('throughput series', pointCount, [
    total.per_gpu,
    prefill.per_gpu,
    decode.per_gpu,
  ]);
  total.per_gpu.forEach((value, index) => {
    const componentTotal = prefill.per_gpu[index] + decode.per_gpu[index];
    invariant(
      Math.abs(value - componentTotal) <= 1e-9,
      `throughput bin ${index} total is not prefill + decode`,
    );
  });
  // The analyzer payload is explicitly per GPU. Existing Run.Throughput is a
  // cluster tok/s series, so the exact run_meta GPU count supplies the unit conversion.
  const clusterRate = (perGpu: number[]) => perGpu.map((value) => value * rawRunMeta.num_gpus);
  return {
    decode: clusterRate(decode.per_gpu),
    prefill: clusterRate(prefill.per_gpu),
    t_end_ms: [...rawThroughput.t_end_ms],
    t_start_ms: [...rawThroughput.t_start_ms],
    total: clusterRate(total.per_gpu),
  };
}

function binMidpoints(start: number[], end: number[], label: string): number[] {
  checkParallelLengths(label, start.length, [end]);
  return start.map((value, index) => (value + end[index]) / 2);
}

function adaptUtilization(): UtilSeries {
  const tMs = binMidpoints(rawUtilization.t_start_ms, rawUtilization.t_end_ms, 'utilization bins');
  rawUtilization.series.forEach((series) =>
    checkParallelLengths(`${series.key} utilization`, tMs.length, [series.util]),
  );
  return {
    t_ms: tMs,
    // Fractions intentionally remain 0-1 and are not clamped; the chart owns percentage display.
    series: rawUtilization.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
      util: [...series.util],
    })),
  };
}

function adaptKv(): KvSeries {
  const tMs = binMidpoints(rawKv.t_start_ms, rawKv.t_end_ms, 'KV bins');
  rawKv.series.forEach((series) =>
    checkParallelLengths(`${series.key} active KV`, tMs.length, [series.active.mean]),
  );
  return {
    t_ms: tMs,
    series: rawKv.series.map((series) => ({
      active: [...series.active.mean],
      capacity: series.capacity_tokens,
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
    })),
  };
}

function adaptBatch(): Readonly<Record<string, BatchSeries>> {
  const pools: Record<string, BatchSeries> = {};
  rawBatch.pools.forEach((pool) => {
    invariant(pools[pool.pool] === undefined, `batch payload repeats pool ${pool.pool}`);
    invariant(
      pool.plotted_points === pool.time_ms.length,
      `batch ${pool.pool} plotted_points mismatch`,
    );
    const batchTokens = requireUniqueByKey(pool.series, 'batch_tokens', `batch ${pool.pool}`);
    const prefillTokens = requireUniqueByKey(pool.series, 'prefill_tokens', `batch ${pool.pool}`);
    const decodeRequests = requireUniqueByKey(
      pool.series,
      'decode_request_count',
      `batch ${pool.pool}`,
    );
    checkParallelLengths(`batch ${pool.pool}`, pool.time_ms.length, [
      batchTokens.values,
      prefillTokens.values,
      decodeRequests.values,
    ]);
    pools[pool.pool] = {
      batchTokens: [...batchTokens.values],
      decodeRequests: [...decodeRequests.values],
      prefillTokens: [...prefillTokens.values],
      t_ms: [...pool.time_ms],
    };
  });
  return pools;
}

function checkStatus(status: 'OK' | 'WARN' | 'FAIL'): CheckStatus {
  if (status === 'OK') return 'ok';
  if (status === 'WARN') return 'warn';
  return 'fail';
}

function adaptConservation(): Conservation {
  const checks = rawConservation.checks.map((check) => ({
    actual: check.actual,
    deltaPct: check.delta_pct,
    description: check.description,
    expected: check.expected,
    name: check.name,
    status: checkStatus(check.status),
  }));
  invariant(
    rawConservation.meta.all_ok === checks.every((check) => check.status === 'ok'),
    'conservation all_ok is inconsistent',
  );
  return { allOk: rawConservation.meta.all_ok, checks };
}

const slo = adaptSlo();
const modelConfigs = new Set(
  topology.pools.flatMap((pool) => pool.groups.map((group) => group.arch.model)),
);
invariant(
  modelConfigs.size === 1,
  `Run domain supports one model config, found ${[...modelConfigs].join(', ')}`,
);
const modelConfig = [...modelConfigs][0];

const realRun: Run = {
  capabilities: {
    concurrencyTimeline: false,
    kernelInputDistribution: false,
    kernelPerformance: false,
    loadImbalance: false,
    perfettoTrace: false,
    traceOverview: false,
    workerIterations: false,
  },
  deployment: rawParams.deployment,
  gpu: gpuName,
  gpuTotal: topologyGpuTotal,
  id: RUN_FOLDER,
  model: modelConfig,
  name: RUN_FOLDER,
  payloads: {
    batchByPool: adaptBatch(),
    conservation: adaptConservation(),
    kernelTimeShare,
    kv: adaptKv(),
    slo,
    throughput: adaptThroughput(),
    utilization: adaptUtilization(),
    // No analyzer v1 artifact exists for concurrency or pending queue length.
  },
  source: {
    kind: 'analyzer_fixture',
    simulationFolder: RUN_FOLDER,
    simulationReexecuted: false,
  },
  summary: {
    e2e_p50: slo.e2e.markers.p50,
    num_gpus: rawSummary.num_gpus,
    // `requests` means completed requests here so it matches every SLO sample count.
    requests: rawSummary.requests_finished,
    requests_total: rawSummary.requests_total,
    total_tok_s: rawSummary.total_tok_s,
    tpot_p50: slo.tpot.markers.p50,
    ttft_p50: slo.ttft.markers.p50,
  },
  topology,
  workerList,
};

export const REAL_RUNS: Run[] = [realRun];
