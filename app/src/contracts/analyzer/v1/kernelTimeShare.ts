import { z, type ZodIssue } from 'zod';

import type {
  KernelTimeComposition,
  KernelTimeShare,
  KernelTimeWorkerComposition,
} from '../../../domain/kernelTimeShare';
import type { SubjectResult } from '../../../domain/subject';
import { makeWorkerKey, makeWorkerRef } from '../../../domain/worker';

// Validate but never normalize wire identities: adapters must not silently
// turn a different pool, position, or source path into a known one.
const nonEmptyString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must contain a non-whitespace character',
  });
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const safeCount = z.number().int().nonnegative().safe();
const positiveSafeCount = safeCount.positive();
// Must match analyzer `TIME_EPSILON_MS`: values above this still produce a
// positive composition whose shares sum to 100.
const KERNEL_TIME_EPSILON_MS = 1e-12;
const RELATIVE_TOLERANCE = 1e-9;
const PERCENTAGE_ABSOLUTE_TOLERANCE = 1e-6;

const segmentSchema = z.object({
  position: nonEmptyString,
  kind: nonEmptyString,
  kernel_time_ms: nonNegative,
  share_pct: nonNegative,
});

const compositionSchema = z.object({
  kernel_time_ms: nonNegative,
  segments: z.array(segmentSchema),
});

const positiveCompositionSchema = compositionSchema.extend({
  kernel_time_ms: finite.positive(),
  segments: z.array(segmentSchema).min(1),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  available: z.literal(true),
  meta: z.object({
    log_dir: nonEmptyString,
    exact: z.boolean(),
    sampling_method: nonEmptyString,
    max_replay_rows_target: safeCount,
    raw_rows: safeCount,
    sampled_rows: safeCount,
    num_positions: positiveSafeCount,
    num_pools: positiveSafeCount,
    num_workers: positiveSafeCount,
    tree_cache_hits: safeCount,
    tree_cache_misses: safeCount,
    kernel_time_totals_exact: z.literal(true),
  }),
  overall: positiveCompositionSchema,
  pools: z
    .array(
      compositionSchema.extend({
        pool_tag: nonEmptyString,
        num_workers: positiveSafeCount,
      }),
    )
    .min(1),
  workers: z
    .array(
      compositionSchema.extend({
        pool_tag: nonEmptyString,
        worker_id: safeCount,
        raw_rows: safeCount,
        sampled_rows: safeCount,
        sample_stride: positiveSafeCount,
      }),
    )
    .min(1),
  positions: z
    .array(
      z.object({
        name: nonEmptyString,
        kind: nonEmptyString,
        overall_share_pct: nonNegative,
      }),
    )
    .min(1),
  definitions: z.record(nonEmptyString),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  available: z.literal(false),
  meta: z.object({
    log_dir: nonEmptyString,
    reason: nonEmptyString,
  }),
  overall: z.record(z.unknown()),
  pools: z.array(z.unknown()).length(0),
  workers: z.array(z.unknown()).length(0),
  positions: z.array(z.unknown()).length(0),
  definitions: z.record(nonEmptyString),
});

const wireSchema = z.discriminatedUnion('available', [readySchema, unavailableSchema]);
type ReadyWire = z.infer<typeof readySchema>;
type CompositionWire = z.infer<typeof compositionSchema>;

export interface KernelTimeShareDecodeOptions {
  /** Fixture exporters may bind a payload to its source run without leaking
   * analyzer paths into the domain model. */
  expectedLogDir?: string;
}

export type KernelTimeShareDecodeResult =
  | Extract<SubjectResult<'kernelTimeShare'>, { status: 'ready' }>
  | Extract<SubjectResult<'kernelTimeShare'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'kernelTimeShare'>, { status: 'incompatible' }>;

const timeCloseEnough = (left: number, right: number): boolean =>
  Math.abs(left - right) <=
  Math.max(KERNEL_TIME_EPSILON_MS, Math.max(Math.abs(left), Math.abs(right)) * RELATIVE_TOLERANCE);

const percentageCloseEnough = (left: number, right: number): boolean =>
  Math.abs(left - right) <=
  Math.max(
    PERCENTAGE_ABSOLUTE_TOLERANCE,
    Math.max(Math.abs(left), Math.abs(right)) * RELATIVE_TOLERANCE,
  );

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

function incompatible(
  issues: readonly string[],
  receivedSchemaVersion?: number,
): KernelTimeShareDecodeResult {
  return {
    subject: 'kernelTimeShare',
    status: 'incompatible',
    reason: `Invalid analyzer-v1 kernel-time-share payload:\n${issues
      .map((issue) => `- ${issue}`)
      .join('\n')}`,
    ...(receivedSchemaVersion === undefined ? {} : { receivedSchemaVersion }),
  };
}

function receivedVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null || !('schema_version' in input)) return undefined;
  const version = (input as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

function validateComposition(
  path: string,
  composition: CompositionWire,
  positionKinds: ReadonlyMap<string, string>,
  issues: string[],
): void {
  const seenPositions = new Set<string>();
  let segmentTimeMs = 0;
  let segmentSharePct = 0;
  composition.segments.forEach((segment, index) => {
    const segmentPath = `${path}.segments.${index}`;
    if (seenPositions.has(segment.position)) {
      issues.push(`${segmentPath}.position: duplicate position ${segment.position}`);
    }
    seenPositions.add(segment.position);
    const expectedKind = positionKinds.get(segment.position);
    if (expectedKind === undefined) {
      issues.push(`${segmentPath}.position: unknown position ${segment.position}`);
    } else if (expectedKind !== segment.kind) {
      issues.push(
        `${segmentPath}.kind: ${segment.kind} disagrees with position kind ${expectedKind}`,
      );
    }
    segmentTimeMs += segment.kernel_time_ms;
    segmentSharePct += segment.share_pct;
    const expectedSegmentSharePct =
      composition.kernel_time_ms <= KERNEL_TIME_EPSILON_MS
        ? 0
        : (segment.kernel_time_ms / composition.kernel_time_ms) * 100;
    if (!percentageCloseEnough(segment.share_pct, expectedSegmentSharePct)) {
      issues.push(
        `${segmentPath}.share_pct: ${segment.share_pct} disagrees with kernel-time ratio ${expectedSegmentSharePct}`,
      );
    }
  });

  if (!timeCloseEnough(segmentTimeMs, composition.kernel_time_ms)) {
    issues.push(
      `${path}.segments: kernel time ${segmentTimeMs} does not sum to ${composition.kernel_time_ms}`,
    );
  }
  const expectedSharePct = composition.kernel_time_ms <= KERNEL_TIME_EPSILON_MS ? 0 : 100;
  if (!percentageCloseEnough(segmentSharePct, expectedSharePct)) {
    issues.push(
      `${path}.segments: share_pct sums to ${segmentSharePct}, expected ${expectedSharePct}`,
    );
  }
}

function timeByPosition(composition: CompositionWire, position: string): number {
  return composition.segments.find((segment) => segment.position === position)?.kernel_time_ms ?? 0;
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues: string[] = [];
  if (wire.overall.kernel_time_ms <= KERNEL_TIME_EPSILON_MS) {
    issues.push(`overall.kernel_time_ms: ready payload must exceed ${KERNEL_TIME_EPSILON_MS} ms`);
  }
  const positionKinds = new Map<string, string>();
  wire.positions.forEach((position, index) => {
    if (positionKinds.has(position.name)) {
      issues.push(`positions.${index}.name: duplicate position ${position.name}`);
    }
    positionKinds.set(position.name, position.kind);
  });

  if (wire.meta.num_positions !== wire.positions.length) {
    issues.push(
      `meta.num_positions: expected ${wire.positions.length}, got ${wire.meta.num_positions}`,
    );
  }
  if (wire.meta.num_pools !== wire.pools.length) {
    issues.push(`meta.num_pools: expected ${wire.pools.length}, got ${wire.meta.num_pools}`);
  }
  if (wire.meta.num_workers !== wire.workers.length) {
    issues.push(`meta.num_workers: expected ${wire.workers.length}, got ${wire.meta.num_workers}`);
  }

  validateComposition('overall', wire.overall, positionKinds, issues);
  wire.pools.forEach((pool, index) =>
    validateComposition(`pools.${index}`, pool, positionKinds, issues),
  );
  wire.workers.forEach((worker, index) =>
    validateComposition(`workers.${index}`, worker, positionKinds, issues),
  );

  const poolsByTag = new Map<string, ReadyWire['pools'][number]>();
  wire.pools.forEach((pool, index) => {
    if (poolsByTag.has(pool.pool_tag)) {
      issues.push(`pools.${index}.pool_tag: duplicate pool ${pool.pool_tag}`);
    }
    poolsByTag.set(pool.pool_tag, pool);
  });

  const workerKeys = new Set<string>();
  wire.workers.forEach((worker, index) => {
    const key = makeWorkerKey(worker.pool_tag, worker.worker_id);
    if (workerKeys.has(key)) {
      issues.push(`workers.${index}: duplicate composite worker ${key}`);
    }
    workerKeys.add(key);
    if (!poolsByTag.has(worker.pool_tag)) {
      issues.push(`workers.${index}.pool_tag: unknown pool ${worker.pool_tag}`);
    }
    if (worker.sampled_rows > worker.raw_rows) {
      issues.push(`workers.${index}.sampled_rows: exceeds raw_rows`);
    }
    if (wire.meta.exact && worker.sample_stride !== 1) {
      issues.push(`workers.${index}.sample_stride: exact payload requires stride 1`);
    }
    if (wire.meta.exact && worker.sampled_rows !== worker.raw_rows) {
      issues.push(`workers.${index}.sampled_rows: exact payload requires all raw rows`);
    }
  });

  wire.pools.forEach((pool, index) => {
    const workers = wire.workers.filter((worker) => worker.pool_tag === pool.pool_tag);
    if (pool.num_workers !== workers.length) {
      issues.push(
        `pools.${index}.num_workers: expected ${workers.length}, got ${pool.num_workers}`,
      );
    }
    const workerTimeMs = workers.reduce((total, worker) => total + worker.kernel_time_ms, 0);
    if (!timeCloseEnough(pool.kernel_time_ms, workerTimeMs)) {
      issues.push(`pools.${index}.kernel_time_ms: does not equal its worker total ${workerTimeMs}`);
    }
    wire.positions.forEach((position) => {
      const poolPositionTimeMs = timeByPosition(pool, position.name);
      const workerPositionTimeMs = workers.reduce(
        (total, worker) => total + timeByPosition(worker, position.name),
        0,
      );
      if (!timeCloseEnough(poolPositionTimeMs, workerPositionTimeMs)) {
        issues.push(
          `pools.${index}.segments: position ${position.name} time ${poolPositionTimeMs} does not equal its worker total ${workerPositionTimeMs}`,
        );
      }
    });
  });

  const poolTimeMs = wire.pools.reduce((total, pool) => total + pool.kernel_time_ms, 0);
  const workerTimeMs = wire.workers.reduce((total, worker) => total + worker.kernel_time_ms, 0);
  if (!timeCloseEnough(wire.overall.kernel_time_ms, poolTimeMs)) {
    issues.push(`overall.kernel_time_ms: does not equal pool total ${poolTimeMs}`);
  }
  if (!timeCloseEnough(wire.overall.kernel_time_ms, workerTimeMs)) {
    issues.push(`overall.kernel_time_ms: does not equal worker total ${workerTimeMs}`);
  }
  wire.positions.forEach((position) => {
    const overallPositionTimeMs = timeByPosition(wire.overall, position.name);
    const poolPositionTimeMs = wire.pools.reduce(
      (total, pool) => total + timeByPosition(pool, position.name),
      0,
    );
    if (!timeCloseEnough(overallPositionTimeMs, poolPositionTimeMs)) {
      issues.push(
        `overall.segments: position ${position.name} time ${overallPositionTimeMs} does not equal pool total ${poolPositionTimeMs}`,
      );
    }
  });

  const rawRows = wire.workers.reduce((total, worker) => total + worker.raw_rows, 0);
  const sampledRows = wire.workers.reduce((total, worker) => total + worker.sampled_rows, 0);
  if (wire.meta.raw_rows !== rawRows) {
    issues.push(`meta.raw_rows: expected worker total ${rawRows}, got ${wire.meta.raw_rows}`);
  }
  if (wire.meta.sampled_rows !== sampledRows) {
    issues.push(
      `meta.sampled_rows: expected worker total ${sampledRows}, got ${wire.meta.sampled_rows}`,
    );
  }

  const overallShares = new Map(
    wire.overall.segments.map((segment) => [segment.position, segment.share_pct]),
  );
  wire.positions.forEach((position, index) => {
    const segmentShare = overallShares.get(position.name) ?? 0;
    if (!percentageCloseEnough(position.overall_share_pct, segmentShare)) {
      issues.push(
        `positions.${index}.overall_share_pct: ${position.overall_share_pct} disagrees with overall segment ${segmentShare}`,
      );
    }
  });
  return issues;
}

function toComposition(wire: CompositionWire): KernelTimeComposition {
  return {
    kernelTimeMs: wire.kernel_time_ms,
    segments: wire.segments.map((segment) => ({
      position: segment.position,
      kind: segment.kind,
      kernelTimeMs: segment.kernel_time_ms,
      sharePct: segment.share_pct,
    })),
  };
}

function toKernelTimeShare(wire: ReadyWire): KernelTimeShare {
  return {
    overall: toComposition(wire.overall),
    pools: wire.pools.map((pool) => ({
      ...toComposition(pool),
      poolTag: pool.pool_tag,
      numWorkers: pool.num_workers,
    })),
    workers: wire.workers.map((worker): KernelTimeWorkerComposition => {
      const ref = makeWorkerRef(worker.pool_tag, worker.worker_id);
      return {
        ...toComposition(worker),
        ref,
        key: makeWorkerKey(ref),
        rawRows: worker.raw_rows,
        sampledRows: worker.sampled_rows,
        sampleStride: worker.sample_stride,
      };
    }),
    positions: wire.positions.map((position) => ({
      name: position.name,
      kind: position.kind,
      overallSharePct: position.overall_share_pct,
    })),
    kernelTimeTotalsExact: true,
    sampling: {
      positionMixExact: wire.meta.exact,
      method: wire.meta.sampling_method,
      rawRows: wire.meta.raw_rows,
      sampledRows: wire.meta.sampled_rows,
      maxReplayRowsTarget: wire.meta.max_replay_rows_target,
    },
    definitions: wire.definitions,
  };
}

/** Decode one analyzer-v1 plot payload. Transport failures stay outside this
 * function so repositories can distinguish them from protocol incompatibility. */
export function decodeAnalyzerV1KernelTimeSharePayload(
  input: unknown,
  options: KernelTimeShareDecodeOptions = {},
): KernelTimeShareDecodeResult {
  const version = receivedVersion(input);
  if (version !== undefined && version !== 1) {
    return incompatible([`schema_version: unsupported version ${version}; expected 1`], version);
  }

  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return incompatible(parsed.error.issues.map(formatIssue), version);
  }
  if (options.expectedLogDir !== undefined && parsed.data.meta.log_dir !== options.expectedLogDir) {
    return incompatible(
      [
        `meta.log_dir: payload belongs to ${parsed.data.meta.log_dir}, expected ${options.expectedLogDir}`,
      ],
      1,
    );
  }
  if (!parsed.data.available) {
    return {
      subject: 'kernelTimeShare',
      status: 'unavailable',
      reason: parsed.data.meta.reason,
    };
  }

  const issues = semanticIssues(parsed.data);
  if (issues.length > 0) return incompatible(issues, 1);
  return {
    subject: 'kernelTimeShare',
    status: 'ready',
    schemaVersion: 1,
    payload: toKernelTimeShare(parsed.data),
  };
}
