import { z } from 'zod';

import type {
  Optimality,
  OptimalityAggregateKernelLadder,
  OptimalityIterationWaterfall,
  OptimalityKernelLadder,
  OptimalityLevel,
} from '../../../domain/optimality';
import type { WorkerRef } from '../../../domain/worker';
import type { SubjectResult } from '../../../domain/subject';
import {
  duplicateKeyIssues,
  finiteNumber,
  formatZodIssue,
  incompatiblePayload,
  nonNegativeNumber,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

/** A telescoping bucket may be reported as a floating-point value fractionally
 * below zero by the analyzer's clamp; treat that as zero, reject anything real. */
const bucketValue = finiteNumber.transform((value) => Math.max(0, value));

const commonBucketsSchema = z.object({
  idle: bucketValue,
  imbalance: bucketValue,
  batching: bucketValue,
  communication: bucketValue,
  hardware_gap: bucketValue,
});
const bucketsSchema = z.union([
  commonBucketsSchema.extend({ hardware_optimal: bucketValue }),
  commonBucketsSchema.extend({
    excess_over_necessary: bucketValue,
    fusion: bucketValue,
    hardware_necessary: bucketValue,
  }),
]);

const ratioSchema = finiteNumber.transform((value) => Math.min(1, Math.max(0, value)));

const levelSchema = z.object({
  level: z.enum(['cluster', 'pool', 'worker', 'iteration']),
  key: wireIdentityString,
  label: z.string().trim().min(1),
  total: nonNegativeNumber,
  buckets: bucketsSchema,
  optimality_ratio: ratioSchema,
  necessary_ratio: ratioSchema.nullable().optional().default(null),
});

const kernelSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  is_comm: z.boolean(),
  real: nonNegativeNumber,
  buckets: z.object({
    batching: bucketValue,
    communication: bucketValue,
    hardware_gap: bucketValue,
    hardware_optimal: bucketValue,
  }),
});

const rungsSchema = z.object({
  real: nonNegativeNumber,
  busy: nonNegativeNumber,
  balanced: nonNegativeNumber,
  per_config_best: nonNegativeNumber,
  ignore_network: nonNegativeNumber,
  hardware_limit: nonNegativeNumber,
  segmented_necessary: nonNegativeNumber.nullable().optional().default(null),
  hardware_necessary: nonNegativeNumber.nullable().optional().default(null),
});

const necessaryWorkSchema = z.object({
  semantics: z.array(z.string()),
  min_flops: nonNegativeNumber,
  min_bytes: nonNegativeNumber,
  compute_gpu_s: nonNegativeNumber,
  memory_gpu_s: nonNegativeNumber,
  necessary_gpu_s: nonNegativeNumber,
  wall_s: nonNegativeNumber,
  redundant_gpu_s: nonNegativeNumber,
  under_accounted_gpu_s: nonNegativeNumber,
  under_accounted_raw_gpu_s: nonNegativeNumber.optional(),
  accounting_tolerance_gpu_s: nonNegativeNumber.optional(),
  bound: z.enum(['compute', 'memory']),
});

const ladderKernelSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  is_comm: z.boolean(),
  rungs: z.object({
    balanced: nonNegativeNumber,
    per_config_best: nonNegativeNumber,
    ignore_network: nonNegativeNumber,
    hardware_limit: nonNegativeNumber,
    necessary_limit: nonNegativeNumber.nullable().optional().default(null),
  }),
  necessary_work: necessaryWorkSchema.nullable().optional().default(null),
});

const workerKernelLadderSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
  worker_id: z.union([z.number().int().nonnegative().safe(), wireIdentityString]),
  rungs: rungsSchema,
  special_chunks: z.object({
    idle: nonNegativeNumber,
    imbalance: nonNegativeNumber,
    fusion: nonNegativeNumber.optional().default(0),
  }),
  kernels: z.array(ladderKernelSchema),
  necessary_work_mode: z
    .enum(['batch_locked', 'replicated_large_batch'])
    .nullable()
    .optional()
    .default(null),
  necessary_work_replication_factor: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .default(null),
});

const aggregateKernelLadderSchema = z.object({
  level: z.enum(['cluster', 'pool']),
  key: wireIdentityString,
  label: z.string().trim().min(1),
  rungs: rungsSchema,
  special_chunks: z.object({
    idle: nonNegativeNumber,
    imbalance: nonNegativeNumber,
    fusion: nonNegativeNumber.optional().default(0),
  }),
  kernels: z.array(ladderKernelSchema),
  necessary_work_mode: z
    .enum(['batch_locked', 'replicated_large_batch'])
    .nullable()
    .optional()
    .default(null),
  necessary_work_replication_factor: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .default(null),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  available: z.literal(true),
  unit: z.literal('gpu_seconds'),
  optimality_ratio: ratioSchema,
  necessary_ratio: ratioSchema.nullable().optional().default(null),
  meta: z
    .object({
      log_dir: wireIdentityString,
      gpu_name: z.string().default(''),
      gpu_spec_matched: z.string().nullable().default(null),
      peaks_source: z.string().default(''),
    })
    .passthrough(),
  levels: z.array(levelSchema).min(1),
  kernels: z.array(kernelSchema).default([]),
  worker_kernel_ladders: z.array(workerKernelLadderSchema).default([]),
  aggregate_kernel_ladders: z.array(aggregateKernelLadderSchema).default([]),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  levels: z.array(z.unknown()).length(0),
  kernels: z.array(z.unknown()).length(0).optional(),
  worker_kernel_ladders: z.array(z.unknown()).length(0).optional(),
  aggregate_kernel_ladders: z.array(z.unknown()).length(0).optional(),
});

const wireSchema = z.union([readySchema, unavailableSchema]);
type ReadyWire = z.infer<typeof readySchema>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return 'available' in wire.meta && wire.meta.available === false;
}

export type OptimalityDecodeResult =
  | Extract<SubjectResult<'optimality'>, { status: 'ready' }>
  | Extract<SubjectResult<'optimality'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'optimality'>, { status: 'incompatible' }>;

/** The six buckets are telescoping differences of the rungs, so they must sum to
 * the level's Real (or Busy) `total`; a mismatch means the ladder was mis-folded. */
function bucketSum(level: z.infer<typeof levelSchema>): number {
  const b = level.buckets;
  const floor =
    'hardware_optimal' in b
      ? b.hardware_optimal
      : b.excess_over_necessary + b.fusion + b.hardware_necessary;
  return b.idle + b.imbalance + b.batching + b.communication + b.hardware_gap + floor;
}

type KernelLadderWire =
  z.infer<typeof workerKernelLadderSchema> | z.infer<typeof aggregateKernelLadderSchema>;

function kernelLadderIssues(path: string, ladder: KernelLadderWire): string[] {
  const issues: string[] = [];
  for (const [wireKey, kernelKey] of [
    ['balanced', 'balanced'],
    ['per_config_best', 'per_config_best'],
    ['ignore_network', 'ignore_network'],
    ['hardware_limit', 'hardware_limit'],
  ] as const) {
    const kernelSum = ladder.kernels.reduce((sum, kernel) => sum + kernel.rungs[kernelKey], 0);
    const expected = ladder.rungs[wireKey];
    const tolerance = Math.max(1e-9, expected * 1e-6);
    if (Math.abs(kernelSum - expected) > tolerance) {
      issues.push(
        `${path}.${wireKey}: kernel sum ${kernelSum} does not reconcile with ${expected}`,
      );
    }
  }
  const hasR6 = ladder.rungs.segmented_necessary !== null;
  const hasR7 = ladder.rungs.hardware_necessary !== null;
  if (hasR6 !== hasR7) issues.push(`${path}: R6 and R7 must be available together`);
  if (hasR6 && hasR7) {
    const r6 = ladder.rungs.segmented_necessary ?? 0;
    const r7 = ladder.rungs.hardware_necessary ?? 0;
    const kernelR6 = ladder.kernels.reduce(
      (sum, kernel) => sum + (kernel.rungs.necessary_limit ?? 0),
      0,
    );
    const tolerance = Math.max(1e-9, r6 * 1e-6);
    if (Math.abs(kernelR6 - r6) > tolerance) {
      issues.push(`${path}: per-location R6 ${kernelR6} does not reconcile with ${r6}`);
    }
    if (Math.abs(r7 + ladder.special_chunks.fusion - r6) > tolerance) {
      issues.push(`${path}: fusion does not reconcile R6 ${r6} with R7 ${r7}`);
    }
  }
  return issues;
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues(
    'levels',
    wire.levels,
    (level) => `${level.level}:${level.key}`,
  );
  wire.levels.forEach((level, index) => {
    const sum = bucketSum(level);
    const tolerance = Math.max(1e-6, level.total * 1e-4);
    if (Math.abs(sum - level.total) > tolerance) {
      issues.push(
        `levels.${index}.buckets: sum ${sum} does not reconcile with total ${level.total}`,
      );
    }
  });
  issues.push(...duplicateKeyIssues('kernels', wire.kernels, (kernel) => kernel.name));
  issues.push(
    ...duplicateKeyIssues('worker_kernel_ladders', wire.worker_kernel_ladders, (row) => row.key),
  );
  issues.push(
    ...duplicateKeyIssues(
      'aggregate_kernel_ladders',
      wire.aggregate_kernel_ladders,
      (row) => `${row.level}:${row.key}`,
    ),
  );
  wire.worker_kernel_ladders.forEach((ladder, index) => {
    issues.push(...kernelLadderIssues(`worker_kernel_ladders.${index}`, ladder));
  });
  wire.aggregate_kernel_ladders.forEach((ladder, index) => {
    issues.push(...kernelLadderIssues(`aggregate_kernel_ladders.${index}`, ladder));
  });
  return issues;
}

function toKernelLadder(
  wire: z.infer<typeof workerKernelLadderSchema>,
  iterId: string | null,
): OptimalityKernelLadder {
  const runCounterfactual =
    iterId === null && wire.necessary_work_mode === 'replicated_large_batch'
      ? ` · ${wire.necessary_work_replication_factor ?? 1}× saturated composition`
      : '';
  return {
    worker: { poolTag: wire.pool_tag, workerId: String(wire.worker_id) },
    iterId,
    label: iterId === null ? `${wire.label}${runCounterfactual}` : `${wire.label} / iter ${iterId}`,
    rungs: {
      real: wire.rungs.real,
      busy: wire.rungs.busy,
      balanced: wire.rungs.balanced,
      perConfigBest: wire.rungs.per_config_best,
      ignoreNetwork: wire.rungs.ignore_network,
      hardwareLimit: wire.rungs.hardware_limit,
      segmentedNecessary: wire.rungs.segmented_necessary,
      hardwareNecessary: wire.rungs.hardware_necessary,
    },
    specialChunks: {
      idle: wire.special_chunks.idle,
      imbalance: wire.special_chunks.imbalance,
      fusion: wire.special_chunks.fusion,
    },
    kernels: wire.kernels.map((kernel) => ({
      name: kernel.name,
      kind: kernel.kind,
      isComm: kernel.is_comm,
      rungs: {
        balanced: kernel.rungs.balanced,
        perConfigBest: kernel.rungs.per_config_best,
        ignoreNetwork: kernel.rungs.ignore_network,
        hardwareLimit: kernel.rungs.hardware_limit,
        necessaryLimit: kernel.rungs.necessary_limit,
      },
      necessaryWork:
        kernel.necessary_work === null
          ? null
          : {
              semantics: kernel.necessary_work.semantics,
              minFlops: kernel.necessary_work.min_flops,
              minBytes: kernel.necessary_work.min_bytes,
              computeGpuSeconds: kernel.necessary_work.compute_gpu_s,
              memoryGpuSeconds: kernel.necessary_work.memory_gpu_s,
              necessaryGpuSeconds: kernel.necessary_work.necessary_gpu_s,
              wallSeconds: kernel.necessary_work.wall_s,
              redundantGpuSeconds: kernel.necessary_work.redundant_gpu_s,
              underAccountedGpuSeconds: kernel.necessary_work.under_accounted_gpu_s,
              underAccountedRawGpuSeconds:
                kernel.necessary_work.under_accounted_raw_gpu_s ??
                kernel.necessary_work.under_accounted_gpu_s,
              accountingToleranceGpuSeconds: kernel.necessary_work.accounting_tolerance_gpu_s ?? 0,
              bound: kernel.necessary_work.bound,
            },
    })),
    necessaryWorkMode: wire.necessary_work_mode,
    necessaryWorkReplicationFactor: wire.necessary_work_replication_factor,
  };
}

function toAggregateKernelLadder(
  wire: z.infer<typeof aggregateKernelLadderSchema>,
): OptimalityAggregateKernelLadder {
  const common = toKernelLadder(
    {
      key: wire.key,
      label: wire.label,
      pool_tag: wire.level === 'pool' ? wire.key : 'cluster',
      worker_id: 0,
      rungs: wire.rungs,
      special_chunks: wire.special_chunks,
      kernels: wire.kernels,
      necessary_work_mode: wire.necessary_work_mode,
      necessary_work_replication_factor: wire.necessary_work_replication_factor,
    },
    null,
  );
  return {
    level: wire.level,
    key: wire.key,
    label:
      wire.necessary_work_mode === 'replicated_large_batch'
        ? `${wire.label} · ${wire.necessary_work_replication_factor ?? 1}× saturated composition`
        : wire.label,
    rungs: common.rungs,
    specialChunks: common.specialChunks,
    kernels: common.kernels,
    necessaryWorkMode: common.necessaryWorkMode,
    necessaryWorkReplicationFactor: common.necessaryWorkReplicationFactor,
  };
}

function toLevel(level: z.infer<typeof levelSchema>): OptimalityLevel {
  const floorBuckets =
    'hardware_optimal' in level.buckets
      ? {
          hardwareOptimal: level.buckets.hardware_optimal,
          excessOverNecessary: 0,
          fusion: 0,
          hardwareNecessary: 0,
        }
      : {
          hardwareOptimal: 0,
          excessOverNecessary: level.buckets.excess_over_necessary,
          fusion: level.buckets.fusion,
          hardwareNecessary: level.buckets.hardware_necessary,
        };
  return {
    level: level.level,
    key: level.key,
    label: level.label,
    total: level.total,
    optimalityRatio: level.optimality_ratio,
    necessaryRatio: 'hardware_optimal' in level.buckets ? null : level.necessary_ratio,
    buckets: {
      idle: level.buckets.idle,
      imbalance: level.buckets.imbalance,
      batching: level.buckets.batching,
      communication: level.buckets.communication,
      hardwareGap: level.buckets.hardware_gap,
      ...floorBuckets,
    },
  };
}

function toLevels(wire: ReadyWire): OptimalityLevel[] {
  return wire.levels.map(toLevel);
}

function toOptimality(wire: ReadyWire): Optimality {
  return {
    unit: 'gpu_seconds',
    optimalityRatio: wire.optimality_ratio,
    necessaryRatio: wire.necessary_ratio,
    gpuName: wire.meta.gpu_name,
    gpuSpecMatched: wire.meta.gpu_spec_matched,
    peaksSource: wire.meta.peaks_source,
    levels: toLevels(wire),
    kernels: wire.kernels.map((kernel) => ({
      name: kernel.name,
      kind: kernel.kind,
      isComm: kernel.is_comm,
      real: kernel.real,
      buckets: {
        batching: kernel.buckets.batching,
        communication: kernel.buckets.communication,
        hardwareGap: kernel.buckets.hardware_gap,
        hardwareOptimal: kernel.buckets.hardware_optimal,
      },
    })),
    workerKernelLadders: wire.worker_kernel_ladders.map((ladder) => toKernelLadder(ladder, null)),
    aggregateKernelLadders: wire.aggregate_kernel_ladders.map(toAggregateKernelLadder),
  };
}

const iterationKernelLadderSchema = z.object({
  schema_version: z.literal(1),
  unit: z.literal('gpu_seconds'),
  worker: z.object({
    pool_tag: wireIdentityString,
    worker_id: z.union([z.number().int().nonnegative().safe(), wireIdentityString]),
  }),
  iter_id: z.union([z.number().int().nonnegative().safe(), wireIdentityString]),
  rungs: rungsSchema,
  special_chunks: z.object({
    idle: nonNegativeNumber,
    imbalance: nonNegativeNumber,
    fusion: nonNegativeNumber.optional().default(0),
  }),
  kernels: z.array(ladderKernelSchema),
  meta: z.object({
    gpu_name: z.string(),
    gpu_spec_matched: z.string().nullable(),
    peaks_source: z.string(),
    gpu_count: nonNegativeNumber,
    folded_rows: z.number().int().positive(),
    necessary_work_mode: z
      .enum(['batch_locked', 'replicated_large_batch'])
      .nullable()
      .optional()
      .default(null),
    necessary_work_replication_factor: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .default(null),
  }),
});

export function decodeAnalyzerV1IterationOptimalityKernelLadder(
  input: unknown,
  expectedWorker: WorkerRef,
  expectedIterId: string,
): OptimalityKernelLadder {
  const wire = iterationKernelLadderSchema.parse(input);
  if (
    wire.worker.pool_tag !== expectedWorker.poolTag ||
    String(wire.worker.worker_id) !== expectedWorker.workerId ||
    String(wire.iter_id) !== expectedIterId
  ) {
    throw new Error('Iteration optimality ladder identity does not match the request.');
  }
  const hasNecessaryRung = wire.rungs.segmented_necessary !== null;
  if (hasNecessaryRung !== (wire.rungs.hardware_necessary !== null)) {
    throw new Error('Iteration R6/R7 necessary-work rungs must be available together.');
  }
  const kernelsHaveNecessaryWork =
    wire.kernels.length > 0 &&
    wire.kernels.every(
      (kernel) => kernel.rungs.necessary_limit !== null && kernel.necessary_work !== null,
    );
  if (hasNecessaryRung !== kernelsHaveNecessaryWork) {
    throw new Error('Iteration necessary-work attribution must be all-or-nothing.');
  }
  if (hasNecessaryRung) {
    const kernelNecessarySum = wire.kernels.reduce(
      (sum, kernel) => sum + (kernel.rungs.necessary_limit ?? 0),
      0,
    );
    const tolerance = Math.max(1e-9, (wire.rungs.segmented_necessary ?? 0) * 1e-6);
    if (Math.abs(kernelNecessarySum - (wire.rungs.segmented_necessary ?? 0)) > tolerance) {
      throw new Error('Iteration kernel necessary-work values do not reconcile with R6.');
    }
    if (
      (wire.rungs.hardware_necessary ?? 0) > (wire.rungs.segmented_necessary ?? 0) + tolerance ||
      Math.abs(
        (wire.rungs.hardware_necessary ?? 0) +
          wire.special_chunks.fusion -
          (wire.rungs.segmented_necessary ?? 0),
      ) > tolerance
    ) {
      throw new Error('Iteration aggregate fusion chunk does not reconcile R6 with R7.');
    }
  }
  const ladder = toKernelLadder(
    {
      key: `${wire.worker.pool_tag}/${String(wire.worker.worker_id)}`,
      label: `${wire.worker.pool_tag}/${String(wire.worker.worker_id)}`,
      pool_tag: wire.worker.pool_tag,
      worker_id: wire.worker.worker_id,
      rungs: wire.rungs,
      special_chunks: wire.special_chunks,
      kernels: wire.kernels,
      necessary_work_mode: wire.meta.necessary_work_mode,
      necessary_work_replication_factor: wire.meta.necessary_work_replication_factor,
    },
    String(wire.iter_id),
  );
  const counterfactual =
    wire.meta.necessary_work_mode === 'replicated_large_batch'
      ? `${wire.meta.necessary_work_replication_factor ?? 1}× large-batch`
      : wire.meta.necessary_work_mode === 'batch_locked'
        ? 'fixed batch'
        : null;
  return {
    ...ladder,
    label: counterfactual === null ? ladder.label : `${ladder.label} · ${counterfactual}`,
    necessaryWorkMode: wire.meta.necessary_work_mode,
    necessaryWorkReplicationFactor: wire.meta.necessary_work_replication_factor,
  };
}

const iterationWaterfallSchema = z.object({
  schema_version: z.literal(1),
  unit: z.literal('gpu_seconds'),
  worker: z.object({
    pool_tag: wireIdentityString,
    worker_id: z.union([z.number().int().nonnegative().safe(), wireIdentityString]),
  }),
  iter_id: z.union([z.number().int().nonnegative().safe(), wireIdentityString]),
  level: levelSchema,
  meta: z.object({
    gpu_name: z.string(),
    gpu_spec_matched: z.string().nullable(),
    peaks_source: z.string(),
    necessary_work_mode: z
      .enum(['batch_locked', 'replicated_large_batch'])
      .nullable()
      .optional()
      .default(null),
    necessary_work_replication_factor: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .default(null),
  }),
});

export function decodeAnalyzerV1IterationOptimalityWaterfall(
  input: unknown,
  expectedWorker: WorkerRef,
  expectedIterId: string,
): OptimalityIterationWaterfall {
  const wire = iterationWaterfallSchema.parse(input);
  if (
    wire.worker.pool_tag !== expectedWorker.poolTag ||
    String(wire.worker.worker_id) !== expectedWorker.workerId ||
    String(wire.iter_id) !== expectedIterId
  ) {
    throw new Error('Iteration optimality waterfall identity does not match the request.');
  }
  if (wire.level.level !== 'iteration') {
    throw new Error('Iteration optimality waterfall must contain an iteration level.');
  }
  const sum = bucketSum(wire.level);
  const tolerance = Math.max(1e-6, wire.level.total * 1e-4);
  if (Math.abs(sum - wire.level.total) > tolerance) {
    throw new Error('Iteration optimality waterfall buckets do not reconcile with its total.');
  }
  const level = toLevel(wire.level);
  const counterfactual =
    wire.meta.necessary_work_mode === 'replicated_large_batch'
      ? `${wire.meta.necessary_work_replication_factor ?? 1}× large-batch`
      : wire.meta.necessary_work_mode === 'batch_locked'
        ? 'fixed batch'
        : null;
  return {
    worker: { poolTag: wire.worker.pool_tag, workerId: String(wire.worker.worker_id) },
    iterId: String(wire.iter_id),
    level:
      counterfactual === null ? level : { ...level, label: `${level.label} · ${counterfactual}` },
    gpuName: wire.meta.gpu_name,
    gpuSpecMatched: wire.meta.gpu_spec_matched,
    peaksSource: wire.meta.peaks_source,
    necessaryWorkMode: wire.meta.necessary_work_mode,
    necessaryWorkReplicationFactor: wire.meta.necessary_work_replication_factor,
  };
}

export function decodeAnalyzerV1OptimalityPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): OptimalityDecodeResult {
  const unsupported = unsupportedV1Payload('optimality', input);
  if (unsupported) return { subject: 'optimality', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'optimality',
      ...incompatiblePayload('optimality', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return { subject: 'optimality', ...incompatiblePayload('optimality', [sourceIssue], 1) };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'optimality', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return { subject: 'optimality', ...incompatiblePayload('optimality', issues, 1) };
  }
  return { subject: 'optimality', status: 'ready', schemaVersion: 1, payload: toOptimality(wire) };
}
