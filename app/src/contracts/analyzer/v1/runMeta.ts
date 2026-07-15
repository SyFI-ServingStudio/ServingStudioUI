import { z, ZodError, type ZodIssue } from 'zod';

const nonNegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveSafeInteger = z.number().int().positive().safe();
const nonBlankIdentity = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must contain a non-whitespace character',
  });

const gpuSchema = z
  .object({
    id: nonNegativeSafeInteger,
    name: nonBlankIdentity,
    pool: nonNegativeSafeInteger,
    worker_id: nonNegativeSafeInteger,
  })
  .strict();

const legacyWorkerSchema = z
  .object({
    worker_id: nonNegativeSafeInteger,
    pool: nonNegativeSafeInteger,
    gpu_ids: z.array(nonNegativeSafeInteger).min(1),
  })
  .strict();

const kvPoolSchema = z
  .object({
    group_id: nonNegativeSafeInteger,
    capacity_tokens: positiveSafeInteger,
  })
  .strict();

const v3WorkerSchema = legacyWorkerSchema
  .extend({
    pool_tag: nonBlankIdentity.nullable(),
    kv_pools: z.array(kvPoolSchema),
  })
  .strict();

const commGroupSchema = z
  .object({
    gid: nonNegativeSafeInteger,
    base: nonNegativeSafeInteger,
    count: positiveSafeInteger,
    gpu_ids: z.array(nonNegativeSafeInteger).min(1),
    owner_pool: nonBlankIdentity,
    owner_worker_id: nonNegativeSafeInteger,
  })
  .strict();

const v1Schema = z
  .object({
    schema_version: z.literal(1),
    num_gpus: positiveSafeInteger,
    gpus: z.array(gpuSchema).min(1),
    workers: z.array(legacyWorkerSchema).min(1),
  })
  .strict();

const v2Schema = z
  .object({
    schema_version: z.literal(2),
    num_gpus: positiveSafeInteger,
    gpus: z.array(gpuSchema).min(1),
    workers: z.array(legacyWorkerSchema).min(1),
    comm_groups: z.array(commGroupSchema),
  })
  .strict();

const v3Schema = z
  .object({
    schema_version: z.literal(3),
    num_gpus: positiveSafeInteger,
    gpus: z.array(gpuSchema).min(1),
    workers: z.array(v3WorkerSchema).min(1),
    comm_groups: z.array(commGroupSchema),
  })
  .strict();

type AnalyzerV1RunMetaWire =
  z.infer<typeof v1Schema> | z.infer<typeof v2Schema> | z.infer<typeof v3Schema>;

export type AnalyzerV1RunMeta = AnalyzerV1RunMetaWire;
export type AnalyzerV1MetaWorker = AnalyzerV1RunMeta['workers'][number];
export type AnalyzerV1CommGroup = z.infer<typeof commGroupSchema>;

function sameNumberSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function addSemanticIssues(meta: AnalyzerV1RunMeta, context: z.RefinementCtx): void {
  if (meta.gpus.length !== meta.num_gpus) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['num_gpus'],
      message: `declares ${meta.num_gpus}, but gpus has ${meta.gpus.length} entries`,
    });
  }

  const gpuById = new Map<number, (typeof meta.gpus)[number]>();
  meta.gpus.forEach((gpu, index) => {
    if (gpuById.has(gpu.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gpus', index, 'id'],
        message: `duplicate GPU id ${gpu.id}`,
      });
    }
    gpuById.set(gpu.id, gpu);
  });
  for (let gpuId = 0; gpuId < meta.num_gpus; gpuId += 1) {
    if (!gpuById.has(gpuId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gpus'],
        message: `missing contiguous GPU id ${gpuId}`,
      });
    }
  }

  const workerKeys = new Set<string>();
  const placedGpuIds: number[] = [];
  meta.workers.forEach((worker, workerIndex) => {
    const workerKey = `${worker.pool}/${worker.worker_id}`;
    if (workerKeys.has(workerKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workers', workerIndex],
        message: `duplicate numeric worker identity ${workerKey}`,
      });
    }
    workerKeys.add(workerKey);

    if (new Set(worker.gpu_ids).size !== worker.gpu_ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workers', workerIndex, 'gpu_ids'],
        message: 'contains duplicate GPU ids',
      });
    }
    worker.gpu_ids.forEach((gpuId) => {
      placedGpuIds.push(gpuId);
      const gpu = gpuById.get(gpuId);
      if (gpu === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workers', workerIndex, 'gpu_ids'],
          message: `references unknown GPU ${gpuId}`,
        });
      } else if (gpu.pool !== worker.pool || gpu.worker_id !== worker.worker_id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workers', workerIndex, 'gpu_ids'],
          message: `GPU ${gpuId} ownership disagrees with worker ${workerKey}`,
        });
      }
    });
  });

  if (meta.schema_version === 3) {
    meta.workers.forEach((worker, workerIndex) => {
      const groupIds = worker.kv_pools.map((pool) => pool.group_id);
      if (new Set(groupIds).size !== groupIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workers', workerIndex, 'kv_pools'],
          message: 'contains duplicate group_id values',
        });
      }
      if (worker.pool_tag === null && worker.kv_pools.length !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workers', workerIndex, 'pool_tag'],
          message: 'is required when kv_pools is non-empty',
        });
      }
    });
  }

  if (
    placedGpuIds.length !== meta.num_gpus ||
    new Set(placedGpuIds).size !== meta.num_gpus ||
    !sameNumberSet(
      placedGpuIds,
      meta.gpus.map((gpu) => gpu.id),
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workers'],
      message: 'worker placement must cover every GPU exactly once',
    });
  }

  if (!('comm_groups' in meta)) return;
  const commGroupIds = new Set<number>();
  meta.comm_groups.forEach((group, groupIndex) => {
    if (commGroupIds.has(group.gid)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comm_groups', groupIndex, 'gid'],
        message: `duplicate comm-group id ${group.gid}`,
      });
    }
    commGroupIds.add(group.gid);
    if (group.count !== group.gpu_ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comm_groups', groupIndex, 'count'],
        message: `declares ${group.count}, but gpu_ids has ${group.gpu_ids.length} entries`,
      });
    }
    const expectedGpuIds = Array.from({ length: group.count }, (_, offset) => group.base + offset);
    if (!sameNumberSet(group.gpu_ids, expectedGpuIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comm_groups', groupIndex, 'gpu_ids'],
        message: 'must equal the contiguous [base, base + count) range',
      });
    }
    group.gpu_ids.forEach((gpuId) => {
      if (!gpuById.has(gpuId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['comm_groups', groupIndex, 'gpu_ids'],
          message: `references unknown GPU ${gpuId}`,
        });
      }
    });
  });
}

/** v1-v3 are all present in the logs tree. v2 adds comm_groups and v3 adds
 * pool_tag/kv_pools; preserving the discriminant prevents version conflation. */
export const analyzerV1RunMetaSchema = z
  .discriminatedUnion('schema_version', [v1Schema, v2Schema, v3Schema])
  .superRefine(addSemanticIssues);

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1RunMetaError extends Error {
  readonly issues: readonly string[];

  constructor(error: ZodError) {
    const issues = error.issues.map(formatIssue);
    super(`Invalid analyzer-v1 run metadata:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1RunMetaError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1RunMeta(input: unknown): AnalyzerV1RunMeta {
  try {
    return analyzerV1RunMetaSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1RunMetaError(error);
    throw error;
  }
}
