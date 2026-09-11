/**
 * Critical-path kernel-time composition, schema 2.
 *
 * Two reads, one subject. The cluster read carries `overall`, every pool in
 * full, the run's position table and definitions, and an *index* of workers —
 * identity, kernel time, sampling counts, no segments. Each worker's own
 * composition is a second read at that worker's address.
 *
 * The split is why the checks here are asymmetric. The cluster read can still
 * prove that pools sum to overall and that workers sum to their pool, because
 * the index keeps every total. What it can no longer prove is that a worker's
 * *mixture* reconciles with its pool's — the segments are not there. That check
 * is genuinely unavailable rather than merely skipped, and rebuilding a
 * position table from the segments under test in order to appear to run it
 * would be a check that cannot fail.
 *
 * Everything below is a pure function of a parsed body, so each rule can be
 * exercised by handing it a literal.
 */
import { z } from 'zod';

import { segmentSchema as addressSegmentSchema } from '../../location';
import type {
  KernelComposition,
  KernelSampling,
  KernelSegment,
  KernelTimeShare,
  PoolKernelComposition,
  WorkerCoordinate,
  WorkerKernelComposition,
  WorkerKernelIndexEntry,
} from '../ref';

export const KERNEL_TIME_SHARE_SCHEMA_VERSION = 2;

/**
 * The analyzer's own threshold for "no reportable kernel time".
 *
 * Sums are compared against it rather than against zero because the composition
 * is assembled from floating-point per-position totals: an exact-equality check
 * would reject a correct payload for its last bit.
 */
export const KERNEL_TIME_EPSILON_MS = 1e-12;
const RELATIVE_TOLERANCE = 1e-9;
const PERCENT_ABSOLUTE_TOLERANCE = 1e-6;

/** Raised when a body parses but says something impossible. Distinct from a
 * Zod failure so `client.ts` can report the two differently. */
export class IncompatibleKernelTimeShareError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`kernel-time-share payload is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleKernelTimeShareError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().safe();
const positiveCount = count.positive();

const segmentSchema = z
  .object({
    position: nonEmpty,
    kind: nonEmpty,
    kernel_time_ms: nonNegative,
    share_pct: nonNegative,
  })
  .strict();

const compositionShape = {
  kernel_time_ms: nonNegative,
  segments: z.array(segmentSchema),
};

const samplingShape = {
  raw_rows: count,
  sampled_rows: count,
  sample_stride: positiveCount,
};

/**
 * Strict, unlike the compositions around it. The index exists precisely so that
 * a worker's segments are *not* here; an older service that still sends them
 * must fail loudly rather than quietly restore the payload this version removed.
 */
const workerIndexSchema = z
  .object({
    pool_tag: nonEmpty,
    worker_id: count,
    kernel_time_ms: nonNegative,
    ...samplingShape,
  })
  .strict();

const clusterSchema = z.object({
  schema_version: z.literal(KERNEL_TIME_SHARE_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z.object({
    exact: z.boolean(),
    sampling_method: nonEmpty,
    raw_rows: count,
    sampled_rows: count,
    num_positions: positiveCount,
    num_pools: positiveCount,
    num_workers: positiveCount,
  }),
  overall: z.object(compositionShape),
  pools: z.array(z.object({ ...compositionShape, pool_tag: nonEmpty, num_workers: positiveCount })),
  workers: z.array(workerIndexSchema),
  positions: z.array(
    z.object({ name: nonEmpty, kind: nonEmpty, overall_share_pct: nonNegative }).strict(),
  ),
  definitions: z.record(nonEmpty),
});

const unavailableSchema = z.object({
  schema_version: z.literal(KERNEL_TIME_SHARE_SCHEMA_VERSION),
  available: z.literal(false),
  meta: z.object({ reason: nonEmpty }),
});

const workerSchema = z.object({
  schema_version: z.literal(KERNEL_TIME_SHARE_SCHEMA_VERSION),
  scope: z.object({ kind: z.literal('worker'), pool_tag: nonEmpty, worker_id: count }),
  ...compositionShape,
  ...samplingShape,
});

type ClusterWire = z.infer<typeof clusterSchema>;
type CompositionWire = { kernel_time_ms: number; segments: z.infer<typeof segmentSchema>[] };

function close(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    Math.max(KERNEL_TIME_EPSILON_MS, Math.max(Math.abs(left), Math.abs(right)) * RELATIVE_TOLERANCE)
  );
}

function percentClose(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    Math.max(
      PERCENT_ABSOLUTE_TOLERANCE,
      Math.max(Math.abs(left), Math.abs(right)) * RELATIVE_TOLERANCE,
    )
  );
}

/**
 * A scope's segments must account for that scope's kernel time, once each, with
 * shares that follow from the times.
 *
 * `positions` is null for a read that does not carry the run's position table.
 * Passing it is what turns "this segment names a position of this run" into a
 * real check; without it that question cannot be asked here.
 */
function checkComposition(
  path: string,
  composition: CompositionWire,
  positions: ReadonlyMap<string, string> | null,
  issues: string[],
): void {
  const seen = new Set<string>();
  let timeMs = 0;
  let sharePct = 0;
  composition.segments.forEach((segment, index) => {
    const at = `${path}.segments.${index}`;
    if (seen.has(segment.position)) issues.push(`${at}: repeats position ${segment.position}`);
    seen.add(segment.position);
    if (positions !== null) {
      const kind = positions.get(segment.position);
      if (kind === undefined) issues.push(`${at}: unknown position ${segment.position}`);
      else if (kind !== segment.kind) issues.push(`${at}: kind ${segment.kind} is not ${kind}`);
    }
    timeMs += segment.kernel_time_ms;
    sharePct += segment.share_pct;
    const expected =
      composition.kernel_time_ms <= KERNEL_TIME_EPSILON_MS
        ? 0
        : (segment.kernel_time_ms / composition.kernel_time_ms) * 100;
    if (!percentClose(segment.share_pct, expected)) {
      issues.push(`${at}: share ${segment.share_pct}% does not follow from its kernel time`);
    }
  });
  if (!close(timeMs, composition.kernel_time_ms)) {
    issues.push(`${path}: segments sum to ${timeMs} ms, not ${composition.kernel_time_ms} ms`);
  }
  const expectedShare = composition.kernel_time_ms <= KERNEL_TIME_EPSILON_MS ? 0 : 100;
  if (!percentClose(sharePct, expectedShare)) {
    issues.push(`${path}: shares sum to ${sharePct}%, not ${expectedShare}%`);
  }
}

function clusterIssues(wire: ClusterWire): string[] {
  const issues: string[] = [];
  const positions = new Map<string, string>();
  wire.positions.forEach((position, index) => {
    if (positions.has(position.name)) issues.push(`positions.${index}: repeats ${position.name}`);
    positions.set(position.name, position.kind);
  });

  const declared: [string, number, number][] = [
    ['num_positions', wire.meta.num_positions, wire.positions.length],
    ['num_pools', wire.meta.num_pools, wire.pools.length],
    ['num_workers', wire.meta.num_workers, wire.workers.length],
  ];
  for (const [name, stated, actual] of declared) {
    if (stated !== actual) issues.push(`meta.${name}: says ${stated}, list has ${actual}`);
  }

  checkComposition('overall', wire.overall, positions, issues);
  wire.pools.forEach((pool, index) => checkComposition(`pools.${index}`, pool, positions, issues));

  const poolTags = new Set<string>();
  wire.pools.forEach((pool, index) => {
    if (poolTags.has(pool.pool_tag)) issues.push(`pools.${index}: repeats ${pool.pool_tag}`);
    poolTags.add(pool.pool_tag);
    // Every pool here becomes a row the reader clicks, and the row writes the
    // tag into the address. This panel is loaded on its own, so the topology's
    // identical check protects nothing here: a tag too long for a route token,
    // or one that is `..` and would rewrite the read's own URL, has to be
    // refused where it is decoded.
    if (!addressSegmentSchema.safeParse({ at: 'pool', role: pool.pool_tag }).success) {
      issues.push(`pools.${index}: pool tag "${clip(pool.pool_tag)}" cannot be put in an address`);
    }
  });

  const workerKeys = new Set<string>();
  wire.workers.forEach((worker, index) => {
    const key = `${worker.pool_tag}/${worker.worker_id}`;
    if (workerKeys.has(key)) issues.push(`workers.${index}: repeats ${key}`);
    workerKeys.add(key);
    if (!poolTags.has(worker.pool_tag)) issues.push(`workers.${index}: unknown pool ${key}`);
    if (worker.sampled_rows > worker.raw_rows) {
      issues.push(`workers.${index}: sampled more rows than it has`);
    }
    if (wire.meta.exact && worker.sample_stride !== 1) {
      issues.push(`workers.${index}: an exact payload cannot have stride ${worker.sample_stride}`);
    }
  });

  // The index keeps every total precisely so these still hold after the
  // segments moved to their own address.
  wire.pools.forEach((pool, index) => {
    const workers = wire.workers.filter((worker) => worker.pool_tag === pool.pool_tag);
    if (pool.num_workers !== workers.length) {
      issues.push(
        `pools.${index}: claims ${pool.num_workers} workers, index has ${workers.length}`,
      );
    }
    const total = workers.reduce((sum, worker) => sum + worker.kernel_time_ms, 0);
    if (!close(pool.kernel_time_ms, total)) {
      issues.push(`pools.${index}: ${pool.kernel_time_ms} ms is not its workers' ${total} ms`);
    }
  });

  const poolTotal = wire.pools.reduce((sum, pool) => sum + pool.kernel_time_ms, 0);
  const workerTotal = wire.workers.reduce((sum, worker) => sum + worker.kernel_time_ms, 0);
  if (!close(wire.overall.kernel_time_ms, poolTotal)) {
    issues.push(`overall: ${wire.overall.kernel_time_ms} ms is not the pools' ${poolTotal} ms`);
  }
  if (!close(wire.overall.kernel_time_ms, workerTotal)) {
    issues.push(`overall: ${wire.overall.kernel_time_ms} ms is not the workers' ${workerTotal} ms`);
  }

  const rawRows = wire.workers.reduce((sum, worker) => sum + worker.raw_rows, 0);
  const sampledRows = wire.workers.reduce((sum, worker) => sum + worker.sampled_rows, 0);
  if (wire.meta.raw_rows !== rawRows) issues.push(`meta.raw_rows: says ${wire.meta.raw_rows}`);
  if (wire.meta.sampled_rows !== sampledRows) {
    issues.push(`meta.sampled_rows: says ${wire.meta.sampled_rows}, workers total ${sampledRows}`);
  }

  // And the mixtures reconcile, not only the totals. Every pool's segments are
  // here in full — this is the one level where they are, which is why the same
  // check is impossible for workers — so a pool that attributed its 40 ms to
  // GEMM while the run attributed it to attention is catchable. Without this,
  // the run bar and the pool bars below it can tell two different stories about
  // the same 100 ms and both look right.
  const overallTime = new Map(
    wire.overall.segments.map((segment) => [segment.position, segment.kernel_time_ms]),
  );
  const pooledTime = new Map<string, number>();
  for (const pool of wire.pools) {
    for (const segment of pool.segments) {
      pooledTime.set(
        segment.position,
        (pooledTime.get(segment.position) ?? 0) + segment.kernel_time_ms,
      );
    }
  }
  for (const position of new Set([...overallTime.keys(), ...pooledTime.keys()])) {
    const stated = overallTime.get(position) ?? 0;
    const pooled = pooledTime.get(position) ?? 0;
    if (!close(stated, pooled)) {
      issues.push(`overall.${position}: ${stated} ms is not the pools' ${pooled} ms`);
    }
  }

  const overallShares = new Map(
    wire.overall.segments.map((segment) => [segment.position, segment.share_pct]),
  );
  wire.positions.forEach((position, index) => {
    const share = overallShares.get(position.name) ?? 0;
    if (!percentClose(position.overall_share_pct, share)) {
      issues.push(
        `positions.${index}: ${position.overall_share_pct}% is not the overall ${share}%`,
      );
    }
  });
  return issues;
}

function toSegments(segments: readonly z.infer<typeof segmentSchema>[]): KernelSegment[] {
  return segments.map((segment) => ({
    position: segment.position,
    kind: segment.kind,
    kernelTimeMs: segment.kernel_time_ms,
    sharePct: segment.share_pct,
  }));
}

function toComposition(wire: CompositionWire): KernelComposition {
  return { kernelTimeMs: wire.kernel_time_ms, segments: toSegments(wire.segments) };
}

function toSampling(wire: { raw_rows: number; sampled_rows: number; sample_stride: number }) {
  return {
    rawRows: wire.raw_rows,
    sampledRows: wire.sampled_rows,
    stride: wire.sample_stride,
  } satisfies KernelSampling;
}

/** Enough of an over-long token to recognise it by, without printing all of it. */
function clip(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}

/** The version the body claims, when it claims one at all. */
export function kernelTimeShareVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

/**
 * The cluster read.
 *
 * An analysis that declares itself unavailable throws with its own reason
 * rather than being decoded into an empty composition: "this run has no
 * critical-path data" and "this run's critical path is empty" are different
 * facts and a panel must be able to say which one it is showing.
 */
export function parseKernelTimeShare(body: unknown): KernelTimeShare {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) {
    throw new UnavailableKernelTimeShareError(unavailable.data.meta.reason);
  }
  const parsed = clusterSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleKernelTimeShareError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      kernelTimeShareVersion(body),
    );
  }
  const issues = clusterIssues(parsed.data);
  if (issues.length > 0) {
    throw new IncompatibleKernelTimeShareError(issues, KERNEL_TIME_SHARE_SCHEMA_VERSION);
  }
  const wire = parsed.data;
  return {
    overall: toComposition(wire.overall),
    pools: wire.pools.map((pool): PoolKernelComposition => ({
      ...toComposition(pool),
      poolTag: pool.pool_tag,
      numWorkers: pool.num_workers,
    })),
    workers: wire.workers.map((worker): WorkerKernelIndexEntry => ({
      worker: { poolTag: worker.pool_tag, workerId: String(worker.worker_id) },
      kernelTimeMs: worker.kernel_time_ms,
      sampling: toSampling(worker),
    })),
    positions: wire.positions.map((position) => ({
      name: position.name,
      kind: position.kind,
      overallSharePct: position.overall_share_pct,
    })),
    sampling: {
      exact: wire.meta.exact,
      method: wire.meta.sampling_method,
      rawRows: wire.meta.raw_rows,
      sampledRows: wire.meta.sampled_rows,
      // A run-level stride would be an average of per-worker strides and would
      // describe no actual sample, so the run reports its counts and each
      // worker reports its own stride.
      stride: 1,
    },
    definitions: wire.definitions,
  };
}

/** Thrown when the analysis ran and reported that it had nothing to compose. */
export class UnavailableKernelTimeShareError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableKernelTimeShareError';
  }
}

/**
 * One worker's read.
 *
 * `requested` is the authority for identity: the address is what the caller
 * asked for, and a payload that names a different worker is rejected instead of
 * being accepted under the requested name. Accepting it would attribute one
 * worker's kernel time to another — a wrong answer that looks entirely normal.
 */
export function parseWorkerKernelTimeShare(
  body: unknown,
  requested: WorkerCoordinate,
): WorkerKernelComposition {
  const parsed = workerSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleKernelTimeShareError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      kernelTimeShareVersion(body),
    );
  }
  const wire = parsed.data;
  const issues: string[] = [];
  const described = `${wire.scope.pool_tag}/${wire.scope.worker_id}`;
  const asked = `${requested.poolTag}/${requested.workerId}`;
  if (described !== asked) issues.push(`scope: describes ${described}, asked for ${asked}`);
  if (wire.sampled_rows > wire.raw_rows) issues.push('sampled more rows than it has');
  checkComposition('worker', wire, null, issues);
  if (issues.length > 0) {
    throw new IncompatibleKernelTimeShareError(issues, KERNEL_TIME_SHARE_SCHEMA_VERSION);
  }
  return {
    ...toComposition(wire),
    worker: requested,
    sampling: toSampling(wire),
  };
}
