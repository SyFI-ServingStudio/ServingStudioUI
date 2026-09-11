/**
 * How busy the hardware was, schema 1 — the *report*, not the series.
 *
 * The payload beside it is 200 bins per pool plus 200 bins per worker; this is
 * the same busy time reduced to one fraction per scope. The question a reader
 * opens it with — was the GPU working, or was the run waiting on something
 * else — is answered by that one number, and the shape of the answer over time
 * is a chart, which is a different panel.
 *
 * ## What is cross-checked, and why these
 *
 * The Analyzer computes each scope's fraction from its own busy-millisecond
 * sum, so the three scopes are three independent divisions of the same
 * quantity, and they are tied together by exactly two identities:
 *
 * - a pool's fraction is its workers' busy time over `span × roster`, so the
 *   workers' fractions sum to the pool's *times its roster* — not to it;
 * - the run's fraction is capacity-weighted the same way, so it is the pools'
 *   fractions weighted by roster, not their plain mean.
 *
 * Both are easy to get wrong in a way that renders: an unweighted mean across
 * pools puts a one-worker pool level with a thirty-two-worker one, and a page
 * that reports 60% for a cluster that was 95% busy is a page nobody can tell is
 * wrong. Checking them here means the panel can just divide.
 *
 * ## What is deliberately *not* checked
 *
 * A fraction above 1 is impossible and is accepted anyway. The Analyzer refuses
 * to clamp on purpose (`utilization/series.rs`): a worker busy 120% of the wall
 * clock means its iteration intervals overlap, which is a defect worth seeing
 * rather than a plot worth smoothing. Refusing the document here would hide the
 * one symptom it was built to expose, so the value is carried through and the
 * panel says what it means.
 *
 * Everything here is a pure function of a parsed body.
 */
import { z } from 'zod';

import { segmentSchema } from '../../location';
import type {
  RunUtilization,
  UtilizationPool,
  UtilizationTimeline,
  UtilizationWorker,
} from '../ref';

export const UTILIZATION_SCHEMA_VERSION = 1;

/**
 * How far the independently-summed fractions may drift apart.
 *
 * Relative, because a fraction is order 1 while the roster it is multiplied by
 * is order 10, and an absolute floor because a cluster of zeros should not have
 * to divide. The quantities being compared are sums over at most a few hundred
 * f64 additions, so 1e-6 is orders of magnitude above the accumulated error and
 * still tight enough to catch a single misattributed worker.
 */
const RELATIVE_TOLERANCE = 1e-6;
const ABSOLUTE_TOLERANCE = 1e-9;

/** Raised when the body parses but says something impossible. */
export class IncompatibleUtilizationError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`utilization artifact is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleUtilizationError';
  }
}

/**
 * Raised when the analysis says it has nothing.
 *
 * Its own class for the same reason as the request-state one: "this run logged
 * no iterations" is a fact about the run, and the reader's next step is a
 * simulator setting rather than a retry.
 */
export class UnavailableUtilizationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableUtilizationError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().safe();

const poolSchema = z
  .object({
    pool: count,
    pool_tag: nonEmpty,
    n_workers: count.positive(),
    // Not `.max(1)`: see the header. An impossible fraction is the payload's
    // way of reporting overlapping busy intervals.
    avg_util: nonNegative,
  })
  .strict();

const workerSchema = z
  .object({
    pool: count,
    pool_tag: nonEmpty,
    worker_id: count,
    avg_util: nonNegative,
  })
  .strict();

const reportSchema = z.object({
  schema_version: z.literal(UTILIZATION_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z
    .object({
      // Empty when the run wrote no `run_meta`; carried as served and turned
      // into `undefined` below, because "" is not the name of a GPU.
      gpu_name: z.string(),
      num_pools: count.positive(),
      num_workers: count.positive(),
      span_ms: finite.positive(),
      num_bins: count.positive(),
      bin_width_ms: nonNegative,
    })
    .passthrough(),
  totals: z.object({
    overall_avg: nonNegative,
    per_pool: z.array(poolSchema).nonempty(),
    per_worker: z.array(workerSchema).nonempty(),
  }),
  definitions: z.record(nonEmpty),
});

/**
 * The unavailable form.
 *
 * `reason` at the top level, as the Analyzer writes it — the same spelling as
 * `request-state` and not the same as `kernel-time-share`, which puts it under
 * `meta`. Mirrored rather than tidied, so that a schema which stopped matching
 * would be a visible failure instead of a silent one.
 */
const unavailableSchema = z.object({
  schema_version: z.literal(UTILIZATION_SCHEMA_VERSION),
  available: z.literal(false),
  reason: nonEmpty,
});

/** The version the body claims, when it claims one at all. */
export function utilizationVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function parseUtilization(body: unknown): RunUtilization {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableUtilizationError(unavailable.data.reason);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleUtilizationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      utilizationVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = reportIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleUtilizationError(issues, UTILIZATION_SCHEMA_VERSION);
  }
  return {
    overall: wire.totals.overall_avg,
    pools: wire.totals.per_pool.map((pool): UtilizationPool => ({
      poolTag: pool.pool_tag,
      workers: pool.n_workers,
      busyFraction: pool.avg_util,
    })),
    workers: wire.totals.per_worker.map((worker): UtilizationWorker => ({
      poolTag: worker.pool_tag,
      workerId: String(worker.worker_id),
      busyFraction: worker.avg_util,
    })),
    gpu: wire.meta.gpu_name === '' ? undefined : wire.meta.gpu_name,
    window: {
      spanMs: wire.meta.span_ms,
      bins: wire.meta.num_bins,
      binWidthMs: wire.meta.bin_width_ms,
    },
    definitions: wire.definitions,
  };
}

const payloadSeriesSchema = z.object({
  key: nonEmpty,
  label: nonEmpty,
  pool_tag: nonEmpty,
  util: z.array(nonNegative),
});

const payloadWorkerIdSchema = z.union([nonEmpty, count.transform(String)]);

const payloadWorkerSchema = z.object({
  key: nonEmpty,
  label: nonEmpty,
  pool_tag: nonEmpty,
  worker_id: payloadWorkerIdSchema,
  util: z.array(nonNegative),
});

const payloadSchema = z.object({
  schema_version: z.literal(UTILIZATION_SCHEMA_VERSION),
  meta: z.object({
    log_dir: nonEmpty,
    gpu_name: z.string().optional().default(''),
    unit: z.literal('fraction of pool workers busy (0-1)'),
    worker_unit: z.literal('fraction of worker/GPU busy time (0-1)').optional(),
    avg: z.record(nonNegative).optional().default({}),
  }),
  t_start_ms: z.array(nonNegative).min(1),
  t_end_ms: z.array(nonNegative).min(1),
  series: z.array(payloadSeriesSchema).min(1),
  // Additive within schema v1. Older artifacts still carry the pool lines.
  worker_series: z.array(payloadWorkerSchema).optional().default([]),
  definitions: z.record(nonEmpty).optional().default({}),
});

const unavailablePayloadSchema = z.object({
  schema_version: z.literal(UTILIZATION_SCHEMA_VERSION),
  meta: z.object({
    log_dir: nonEmpty,
    available: z.literal(false),
    reason: nonEmpty,
  }),
  t_start_ms: z.array(z.unknown()).length(0),
  t_end_ms: z.array(z.unknown()).length(0),
  series: z.array(z.unknown()).length(0),
  worker_series: z.array(z.unknown()).length(0).optional(),
});

type PayloadWire = z.infer<typeof payloadSchema>;

/** Decode the full-resolution pool and worker series used by the old chart. */
export function parseUtilizationSeries(body: unknown): UtilizationTimeline {
  const unavailable = unavailablePayloadSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableUtilizationError(unavailable.data.meta.reason);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleUtilizationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      utilizationVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = payloadIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleUtilizationError(issues, UTILIZATION_SCHEMA_VERSION);
  }
  return {
    tMs: wire.t_start_ms.map((start, index) => (start + wire.t_end_ms[index]) / 2),
    series: wire.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
      util: [...series.util],
    })),
    workerSeries: wire.worker_series.map((series) => ({
      key: `${encodeURIComponent(series.pool_tag)}/${encodeURIComponent(series.worker_id)}`,
      label: series.label,
      worker: { poolTag: series.pool_tag, workerId: series.worker_id },
      util: [...series.util],
    })),
    sourceLogDir: wire.meta.log_dir,
    gpuName: wire.meta.gpu_name === '' ? null : wire.meta.gpu_name,
    unit: wire.meta.unit,
    workerUnit: wire.meta.worker_unit ?? null,
    averages: wire.meta.avg,
    definitions: wire.definitions,
  };
}

function payloadIssues(wire: PayloadWire): string[] {
  const issues: string[] = [];
  const points = wire.t_start_ms.length;
  if (wire.t_end_ms.length !== points) {
    issues.push(`t_end_ms: has ${wire.t_end_ms.length} points, expected ${points}`);
  }
  wire.t_start_ms.forEach((start, index) => {
    const end = wire.t_end_ms[index];
    if (end !== undefined && end <= start) {
      issues.push(`t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
  });

  const pools = new Set<string>();
  const keys = new Set<string>();
  wire.series.forEach((series, index) => {
    if (keys.has(series.key)) issues.push(`series.${index}.key: duplicate ${series.key}`);
    keys.add(series.key);
    if (pools.has(series.pool_tag)) {
      issues.push(`series.${index}.pool_tag: duplicate ${series.pool_tag}`);
    }
    pools.add(series.pool_tag);
    if (series.util.length !== points) {
      issues.push(`series.${index}.util: has ${series.util.length} points, expected ${points}`);
    }
    const average = wire.meta.avg[series.key];
    if (average !== undefined && !near(average, sum(series.util) / series.util.length)) {
      issues.push(`meta.avg.${series.key}: does not match the series mean`);
    }
  });

  const workerKeys = new Set<string>();
  const workers = new Set<string>();
  wire.worker_series.forEach((series, index) => {
    if (workerKeys.has(series.key)) {
      issues.push(`worker_series.${index}.key: duplicate ${series.key}`);
    }
    workerKeys.add(series.key);
    const identity = `${series.pool_tag}\u0000${series.worker_id}`;
    if (workers.has(identity)) {
      issues.push(
        `worker_series.${index}: duplicate worker ${series.pool_tag}/${series.worker_id}`,
      );
    }
    workers.add(identity);
    if (!pools.has(series.pool_tag)) {
      issues.push(`worker_series.${index}.pool_tag: unknown pool ${series.pool_tag}`);
    }
    if (series.util.length !== points) {
      issues.push(
        `worker_series.${index}.util: has ${series.util.length} points, expected ${points}`,
      );
    }
  });

  if (wire.worker_series.length > 0) {
    wire.series.forEach((pool, poolIndex) => {
      const own = wire.worker_series.filter((worker) => worker.pool_tag === pool.pool_tag);
      if (own.length === 0) {
        issues.push(`series.${poolIndex}: no worker series for pool ${pool.pool_tag}`);
        return;
      }
      pool.util.forEach((actual, bin) => {
        const expected = sum(own.map((worker) => worker.util[bin])) / own.length;
        if (!near(actual, expected)) {
          issues.push(
            `series.${poolIndex}.util.${bin}: ${actual} does not match worker average ${expected}`,
          );
        }
      });
    });
  }
  return issues;
}

type Wire = z.infer<typeof reportSchema>;

function reportIssues(wire: Wire): string[] {
  const issues: string[] = [];
  const { overall_avg: overall, per_pool: pools, per_worker: workers } = wire.totals;

  // The window has to be the one the busy time was measured over: `bin_width_ms`
  // is `span_ms / num_bins` at the source, and three numbers that do not agree
  // describe a different aggregation than the one they name.
  if (!near(wire.meta.bin_width_ms, wire.meta.span_ms / wire.meta.num_bins)) {
    issues.push(
      `meta: ${wire.meta.num_bins} bins of ${wire.meta.bin_width_ms} ms do not span ${wire.meta.span_ms} ms`,
    );
  }
  // `meta` is what a caption reports and the lists are what the rows are drawn
  // from. A run that says it had 33 workers and lists 8 renders either way.
  if (wire.meta.num_pools !== pools.length) {
    issues.push(`meta: ${wire.meta.num_pools} pools declared, ${pools.length} listed`);
  }
  if (wire.meta.num_workers !== workers.length) {
    issues.push(`meta: ${wire.meta.num_workers} workers declared, ${workers.length} listed`);
  }

  // A pool tag becomes a path segment the moment a reader clicks its row, so a
  // tag the location parser will not read back is a link that leads nowhere.
  const published = new Set<string>();
  for (const pool of pools) {
    if (published.has(pool.pool_tag)) {
      issues.push(`totals.per_pool: pool "${pool.pool_tag}" appears more than once`);
    }
    published.add(pool.pool_tag);
    if (!segmentSchema.safeParse({ at: 'pool', role: pool.pool_tag }).success) {
      issues.push(`totals.per_pool: pool tag "${clip(pool.pool_tag)}" cannot be put in an address`);
    }
  }

  const identities = new Set<string>();
  for (const worker of workers) {
    const identity = `${worker.pool_tag}/${worker.worker_id}`;
    if (identities.has(identity)) {
      issues.push(
        `totals.per_worker: pool "${worker.pool_tag}" lists worker ${worker.worker_id} more than once`,
      );
    }
    identities.add(identity);
    if (!published.has(worker.pool_tag)) {
      issues.push(
        `totals.per_worker: worker ${worker.worker_id} names pool "${worker.pool_tag}", which totals.per_pool does not publish`,
      );
    }
  }

  let capacity = 0;
  let weighted = 0;
  for (const pool of pools) {
    capacity += pool.n_workers;
    weighted += pool.avg_util * pool.n_workers;
    const own = workers.filter((worker) => worker.pool_tag === pool.pool_tag);
    // The roster, not the workers that saw traffic: the Analyzer seeds every
    // pool from `run_meta` so an idle worker stays visible as a zero. A pool
    // listing fewer workers than it declares would divide its busy time by a
    // capacity the rows below it do not account for — which is exactly how a
    // saturated-looking pool hides an idle member.
    if (own.length !== pool.n_workers) {
      issues.push(
        `totals: pool "${pool.pool_tag}" declares ${pool.n_workers} workers, but ${own.length} are listed`,
      );
      continue;
    }
    // Fractions do not add; busy time does. Each worker's fraction is its busy
    // time over the span, and the pool's is over the span times its roster, so
    // the workers sum to the pool scaled up by that roster.
    const summed = sum(own.map((worker) => worker.avg_util));
    if (!near(summed, pool.avg_util * pool.n_workers)) {
      issues.push(
        `totals: pool "${pool.pool_tag}" is ${pool.avg_util} busy across ${pool.n_workers} workers, but those workers sum to ${summed}`,
      );
    }
  }
  if (issues.length > 0) return issues;

  // The run is capacity-weighted for the same reason, one level up. A plain
  // mean across pools would let a single-worker pool outvote a 32-worker one,
  // and the number it produced would still be a plausible percentage.
  if (!near(overall * capacity, weighted)) {
    issues.push(
      `totals: the run is ${overall} busy over ${capacity} workers, but its pools weigh ${weighted}`,
    );
  }
  return issues;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Equal to within what independently-summed floating point can differ by. */
function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(right);
}

/** Enough of an over-long token to recognise it by, without printing all of it. */
function clip(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}
