import { z } from 'zod';

import type {
  Optimality,
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
  }),
});

const workerKernelLadderSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
  worker_id: z.union([z.number().int().nonnegative().safe(), wireIdentityString]),
  rungs: rungsSchema,
  special_chunks: z.object({ idle: nonNegativeNumber, imbalance: nonNegativeNumber }),
  kernels: z.array(ladderKernelSchema),
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
  return issues;
}

function toKernelLadder(
  wire: z.infer<typeof workerKernelLadderSchema>,
  iterId: string | null,
): OptimalityKernelLadder {
  return {
    worker: { poolTag: wire.pool_tag, workerId: String(wire.worker_id) },
    iterId,
    label: iterId === null ? wire.label : `${wire.label} / iter ${iterId}`,
    rungs: {
      real: wire.rungs.real,
      busy: wire.rungs.busy,
      balanced: wire.rungs.balanced,
      perConfigBest: wire.rungs.per_config_best,
      ignoreNetwork: wire.rungs.ignore_network,
      hardwareLimit: wire.rungs.hardware_limit,
    },
    specialChunks: {
      idle: wire.special_chunks.idle,
      imbalance: wire.special_chunks.imbalance,
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
      },
    })),
  };
}

function toLevels(wire: ReadyWire): OptimalityLevel[] {
  return wire.levels.map((level) => {
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
  });
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
  special_chunks: z.object({ idle: nonNegativeNumber, imbalance: nonNegativeNumber }),
  kernels: z.array(ladderKernelSchema),
  meta: z.object({
    gpu_name: z.string(),
    gpu_spec_matched: z.string().nullable(),
    peaks_source: z.string(),
    gpu_count: nonNegativeNumber,
    folded_rows: z.number().int().positive(),
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
  return toKernelLadder(
    {
      key: `${wire.worker.pool_tag}/${String(wire.worker.worker_id)}`,
      label: `${wire.worker.pool_tag}/${String(wire.worker.worker_id)}`,
      pool_tag: wire.worker.pool_tag,
      worker_id: wire.worker.worker_id,
      rungs: wire.rungs,
      special_chunks: wire.special_chunks,
      kernels: wire.kernels,
    },
    String(wire.iter_id),
  );
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
