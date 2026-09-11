/**
 * How much work was in each kernel invocation, schema 1 — the `report`.
 *
 * Every row of the simulator's cost log is one invocation (`worker × iter ×
 * batch × layer × section`), and this is the distribution of three counts over
 * those invocations, per pool and per worker: how many tokens were in the batch,
 * how many of them were being prefilled, and how many decode requests were
 * riding along.
 *
 * ## Why this is not the utilization subject again
 *
 * Utilization says the GPU was busy. This says what it was busy *with*. A run at
 * 99% utilization whose median batch is one token is a run doing almost nothing
 * per invocation, and no other subject on the page can tell that from a run at
 * 99% with full batches. The two are read together or not at all.
 *
 * ## The mean is not the batch
 *
 * These distributions are extremely skewed: a live run reports mean 6.98 with a
 * median of 1 and a max of 1025, because a handful of prefill invocations carry
 * a thousand tokens each and everything else carries one. A panel that led with
 * the mean would describe a batch size that never occurred. So the percentiles
 * are the point, and this parser refuses a report whose percentiles do not
 * ascend — they come off one sorted array at the source, so a report where they
 * do not is describing something other than a distribution.
 *
 * ## What the three counts add up to, and what the gap means
 *
 * Row-wise the simulator writes `batch_tokens = prefill_tokens +
 * decode_query_rows` (`worker/execution/unified_iter_execution.rs`), and
 * `decode_query_rows` equals `decode_request_count` for an ordinary engine and
 * *exceeds* it by the draft rows under speculative decoding
 * (`log/schemas.rs`). The report publishes the request count and not the query
 * rows, so:
 *
 * - the means satisfy `batch >= prefill + decode_requests`, by linearity, and
 * - the excess is exactly the mean number of speculative draft rows per
 *   invocation — rows the GPU processed that were not requests.
 *
 * This build enforces the inequality and hands the excess to the panel as a
 * measurement rather than treating it as slack. Enforcing *equality* would
 * refuse every speculative run; all 37 runs on the live Analyzer are ordinary
 * and satisfy it exactly, which is why it has to be checked against the
 * simulator rather than against them.
 *
 * The excess is the **draft rows**, not the verify width. One speculating
 * request submits `draft_tokens + 1` rows (`worker/cost_buffers.rs`) — one it
 * would have submitted anyway, and `draft_tokens` more — and the request count
 * already accounts for the first. So `batch - prefill - requests` is
 * `requests x draft_tokens`, and calling it the verify width would overstate
 * every row by one per request.
 *
 * ## Two of the three counts are not always recorded
 *
 * An FFN pool logs its batch size and writes literal zeros into the other two:
 * "the attention-shaped fields stay zero/empty (the ffn cost never read them)"
 * (`worker/cost_buffers.rs`). Read at face value that is a batch of 64 tokens
 * made of no prefill and no decode requests, and the whole 64 falls out of the
 * subtraction above as speculation — on an ordinary run, in a pool that cannot
 * speculate.
 *
 * They are distinguishable. On the attention side `batch_tokens = prefill_tokens
 * + decode_query_rows`, so a positive batch forces one of the two to be
 * positive, and `decode_query_rows` is `requests x (draft + 1)` — zero exactly
 * when the request count is. A mean batch above zero with both other means at
 * exactly zero is therefore impossible where the fields are populated, and is
 * precisely the FFN signature. Those scopes keep their batch distribution and
 * lose the composition, the same shape as a scope that was never sampled.
 *
 * The signature needs a batch to read it off. Where the mean batch is zero the
 * two are indistinguishable — an attention pool whose sampled invocations all
 * carried nothing writes the same three zeros the FFN logger writes without
 * looking — so this parser publishes the composition only where there were
 * tokens *and* they are accounted for. The flag is a claim about where the
 * figures came from, not about what they are: on an empty batch the zeros are
 * right whichever logger wrote them, but "no draft rows" inferred from two
 * columns that may never have been written is a statement about speculation
 * drawn from nothing.
 *
 * Everything here is a pure function of a parsed body.
 */
import { z } from 'zod';

import { segmentSchema } from '../../location';
import type {
  BatchMetric,
  BatchScope,
  BatchTimeline,
  BatchTimelineScope,
  RunBatchComposition,
} from '../ref';

export const BATCH_COMPOSITION_SCHEMA_VERSION = 1;

/**
 * How far the mean identity may miss by.
 *
 * Three means of the same sample, each a sum of `u32` counts divided by the
 * same integer. The sums reach ~10^6 in f64, so the round trip is exact to a
 * few ulps of a number of that size.
 */
const RELATIVE_TOLERANCE = 1e-9;
const ABSOLUTE_TOLERANCE = 1e-9;

/** Raised when the body parses but says something impossible. */
export class IncompatibleBatchCompositionError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`batch artifact is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleBatchCompositionError';
  }
}

/**
 * Raised when the analysis says it has nothing.
 *
 * A run with no cost log reaches this, and so does one whose log has no
 * invocations. Neither is a failure: the reader's next step is a simulator
 * setting, or nothing at all.
 */
export class UnavailableBatchCompositionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableBatchCompositionError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const count = z.number().int().nonnegative().safe();

/**
 * One metric's distribution over the sampled invocations.
 *
 * Every figure but `n` is nullable, and all of them are null together: the
 * producer returns them from one `stats()` call that answers `None` for an
 * empty sample. Read separately they would allow a distribution with a maximum
 * and no median.
 */
const metricSchema = z
  .object({
    n: count,
    mean: finite.nonnegative().nullable(),
    p50: finite.nonnegative().nullable(),
    p90: finite.nonnegative().nullable(),
    p99: finite.nonnegative().nullable(),
    max: finite.nonnegative().nullable(),
  })
  .strict();

const metricsSchema = z
  .object({
    batch_tokens: metricSchema,
    prefill_tokens: metricSchema,
    decode_request_count: metricSchema,
  })
  .strict();

const poolSchema = z.object({ pool: nonEmpty, num_calls: count, metrics: metricsSchema }).strict();

const workerSchema = z
  .object({
    pool_tag: nonEmpty,
    worker_id: count,
    num_calls: count,
    metrics: metricsSchema,
  })
  .strict();

const reportSchema = z.object({
  schema_version: z.literal(BATCH_COMPOSITION_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z.object({ num_calls: count }).passthrough(),
  pools: z.array(poolSchema).nonempty(),
  workers: z.array(workerSchema),
  definitions: z.record(nonEmpty),
});

/** The unavailable form, spelled as the Analyzer spells it. */
const unavailableSchema = z.object({
  schema_version: z.literal(BATCH_COMPOSITION_SCHEMA_VERSION),
  available: z.literal(false),
  reason: nonEmpty,
});

/** The version the body claims, when it claims one at all. */
export function batchCompositionVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function parseBatchComposition(body: unknown): RunBatchComposition {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableBatchCompositionError(unavailable.data.reason);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleBatchCompositionError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      batchCompositionVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = reportIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleBatchCompositionError(issues, BATCH_COMPOSITION_SCHEMA_VERSION);
  }
  return {
    pools: wire.pools.map((pool) => scopeOf(pool.pool, null, pool.num_calls, pool.metrics)),
    workers: wire.workers.map((worker) =>
      scopeOf(worker.pool_tag, String(worker.worker_id), worker.num_calls, worker.metrics),
    ),
    invocations: wire.meta.num_calls,
    definitions: wire.definitions,
  };
}

const timelineValueSeriesSchema = z.object({
  key: nonEmpty,
  label: nonEmpty,
  values: z.array(finite.nonnegative()),
});

const timelineAveragesSchema = z.record(finite.nonnegative()).optional().default({});

const timelinePoolSchema = z.object({
  pool: nonEmpty,
  num_calls: count,
  plotted_points: count.positive(),
  avg: timelineAveragesSchema,
  time_ms: z.array(finite.nonnegative()).min(1),
  series: z.array(timelineValueSeriesSchema).min(3),
});

const timelineWorkerIdSchema = z.union([nonEmpty, count.transform(String)]);

const timelineWorkerSchema = timelinePoolSchema.omit({ pool: true }).extend({
  pool_tag: nonEmpty,
  worker_id: timelineWorkerIdSchema,
});

const timelineSchema = z.object({
  schema_version: z.literal(BATCH_COMPOSITION_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z.object({ log_dir: nonEmpty, num_calls: count }),
  pools: z.array(timelinePoolSchema).min(1),
  // Additive within schema v1. Older payloads only publish pool scatters.
  workers: z.array(timelineWorkerSchema).optional().default([]),
  definitions: z.record(nonEmpty).optional().default({}),
});

const unavailableTimelineSchema = z.object({
  schema_version: z.literal(BATCH_COMPOSITION_SCHEMA_VERSION),
  meta: z.object({ log_dir: nonEmpty, available: z.literal(false), reason: nonEmpty }),
  pools: z.array(z.unknown()).length(0),
  workers: z.array(z.unknown()).length(0).optional(),
});

type TimelineWire = z.infer<typeof timelineSchema>;
type TimelinePoolWire = z.infer<typeof timelinePoolSchema>;
type TimelineScopeWire = Pick<
  TimelinePoolWire,
  'num_calls' | 'plotted_points' | 'avg' | 'time_ms' | 'series'
>;

const TIMELINE_METRICS = ['batch_tokens', 'prefill_tokens', 'decode_request_count'] as const;

/** Decode pool and worker invocation scatters without reducing them to report percentiles. */
export function parseBatchSeries(body: unknown): BatchTimeline {
  const unavailable = unavailableTimelineSchema.safeParse(body);
  if (unavailable.success) {
    throw new UnavailableBatchCompositionError(unavailable.data.meta.reason);
  }
  const parsed = timelineSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleBatchCompositionError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      batchCompositionVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = timelineIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleBatchCompositionError(issues, BATCH_COMPOSITION_SCHEMA_VERSION);
  }
  return {
    pools: wire.pools.map((pool) => timelineScope(pool, pool.pool, null)),
    workers: wire.workers.map((worker) => timelineScope(worker, worker.pool_tag, worker.worker_id)),
    sourceLogDir: wire.meta.log_dir,
    invocations: wire.meta.num_calls,
    definitions: wire.definitions,
  };
}

function timelineScope(
  wire: TimelineScopeWire,
  poolTag: string,
  workerId: string | null,
): BatchTimelineScope {
  return {
    poolTag,
    workerId,
    invocations: wire.num_calls,
    plottedPoints: wire.plotted_points,
    timeMs: [...wire.time_ms],
    series: wire.series.map((series) => ({
      key: series.key,
      label: series.label,
      values: [...series.values],
    })),
    averages: wire.avg,
  };
}

function timelineIssues(wire: TimelineWire): string[] {
  const issues: string[] = [];
  const poolTags = new Set<string>();
  wire.pools.forEach((pool, index) => {
    if (poolTags.has(pool.pool)) issues.push(`pools.${index}.pool: duplicate ${pool.pool}`);
    poolTags.add(pool.pool);
    timelineScopeIssues(issues, `pools.${index}`, pool);
  });

  const poolCalls = wire.pools.reduce((total, pool) => total + pool.num_calls, 0);
  if (poolCalls > wire.meta.num_calls) {
    issues.push(
      `meta.num_calls: ${wire.meta.num_calls} is below published pool total ${poolCalls}`,
    );
  }

  const workerKeys = new Set<string>();
  wire.workers.forEach((worker, index) => {
    const identity = `${worker.pool_tag}\u0000${worker.worker_id}`;
    if (workerKeys.has(identity)) {
      issues.push(`workers.${index}: duplicate worker ${worker.pool_tag}/${worker.worker_id}`);
    }
    workerKeys.add(identity);
    if (!poolTags.has(worker.pool_tag)) {
      issues.push(`workers.${index}.pool_tag: unknown pool ${worker.pool_tag}`);
    }
    timelineScopeIssues(issues, `workers.${index}`, worker);
  });

  wire.pools.forEach((pool, poolIndex) => {
    const workerCalls = wire.workers
      .filter((worker) => worker.pool_tag === pool.pool)
      .reduce((total, worker) => total + worker.num_calls, 0);
    if (workerCalls > pool.num_calls) {
      issues.push(
        `pools.${poolIndex}.num_calls: ${pool.num_calls} is below published worker total ${workerCalls}`,
      );
    }
  });
  return issues;
}

function timelineScopeIssues(issues: string[], where: string, scope: TimelineScopeWire): void {
  if (scope.plotted_points !== scope.time_ms.length) {
    issues.push(
      `${where}.plotted_points: expected ${scope.time_ms.length}, got ${scope.plotted_points}`,
    );
  }
  if (scope.plotted_points > scope.num_calls) {
    issues.push(
      `${where}.plotted_points: ${scope.plotted_points} exceeds ${scope.num_calls} calls`,
    );
  }
  scope.time_ms.forEach((value, index) => {
    if (index > 0 && value < scope.time_ms[index - 1]) {
      issues.push(`${where}.time_ms.${index}: must not decrease`);
    }
  });
  const seriesKeys = new Set<string>();
  scope.series.forEach((series, index) => {
    if (seriesKeys.has(series.key)) {
      issues.push(`${where}.series.${index}.key: duplicate ${series.key}`);
    }
    seriesKeys.add(series.key);
    if (series.values.length !== scope.time_ms.length) {
      issues.push(
        `${where}.series.${index}.values: has ${series.values.length} points, expected ${scope.time_ms.length}`,
      );
    }
  });
  TIMELINE_METRICS.forEach((key) => {
    if (!seriesKeys.has(key)) issues.push(`${where}.series: missing required ${key} series`);
    if (Object.keys(scope.avg).length > 0 && scope.avg[key] === undefined) {
      issues.push(`${where}.avg: missing required ${key} average`);
    }
  });
}

type Wire = z.infer<typeof reportSchema>;
type WireMetrics = z.infer<typeof metricsSchema>;
type WireMetric = z.infer<typeof metricSchema>;

function scopeOf(
  poolTag: string,
  workerId: string | null,
  invocations: number,
  metrics: WireMetrics,
): BatchScope {
  // See the header. A pool that does not log what its batches were made of
  // writes zeros rather than nulls, and zeros are a composition.
  const composed = hasMeasuredComposition(metrics);
  return {
    poolTag,
    workerId,
    invocations,
    sampled: metrics.batch_tokens.n,
    batchTokens: metricOf(metrics.batch_tokens),
    prefillTokens: composed ? metricOf(metrics.prefill_tokens) : null,
    decodeRequests: composed ? metricOf(metrics.decode_request_count) : null,
    // A measurement, not slack. See the header: this is the mean number of
    // draft rows per invocation, and it is 0 for an ordinary engine. `null`
    // when there is no sample to have measured it over, and when the two counts
    // it is a residue of were never recorded.
    draftRows: composed ? draftRowsOf(metrics) : null,
  };
}

/**
 * Whether this scope's prefill and decode counts are measurements of it.
 *
 * There were tokens, and they are accounted for. Both halves are needed. A
 * positive mean batch with both other means at exactly zero cannot happen where
 * the fields are populated — there the batch is their sum — so it is the FFN
 * logger's zeros and nothing else. And a mean batch of zero carries no evidence
 * either way: it is what an FFN pool writes and what an attention pool measures
 * when every sampled invocation carried nothing, and the parser has no third
 * column to break the tie with. See the header for why the distinction is worth
 * drawing on figures that are zero in both readings.
 *
 * Named for what it tests rather than for the FFN case: it is also false when
 * nothing was sampled, where there is no composition because there are no rows.
 * Exact comparisons throughout, because the means are of non-negative integers
 * — a mean of zero is every row at zero, with no rounding to allow for.
 */
function hasMeasuredComposition(metrics: WireMetrics): boolean {
  const { batch_tokens: batch, prefill_tokens: prefill, decode_request_count: decode } = metrics;
  if (batch.mean === null || prefill.mean === null || decode.mean === null) return false;
  return batch.mean > 0 && (prefill.mean > 0 || decode.mean > 0);
}

function metricOf(metric: WireMetric): BatchMetric | null {
  if (metric.mean === null) return null;
  return {
    samples: metric.n,
    mean: metric.mean,
    // Non-null together with `mean`, which `metricIssues` has already checked.
    p50: metric.p50 ?? 0,
    p90: metric.p90 ?? 0,
    p99: metric.p99 ?? 0,
    max: metric.max ?? 0,
  };
}

/**
 * The draft rows, as the residue the three published counts leave.
 *
 * Not the verify width: one speculating request submits `draft_tokens + 1`
 * rows and the request count has already counted the first, so what is left
 * over is `requests x draft_tokens`. See the header.
 */
function draftRowsOf(metrics: WireMetrics): number | null {
  const { batch_tokens: batch, prefill_tokens: prefill, decode_request_count: decode } = metrics;
  if (batch.mean === null || prefill.mean === null || decode.mean === null) return null;
  // Clamped at zero only for the ulp: `reportIssues` has already refused
  // anything that misses the identity by more than the tolerance, so what is
  // left here is rounding and not a negative count of rows.
  return Math.max(batch.mean - prefill.mean - decode.mean, 0);
}

function reportIssues(wire: Wire): string[] {
  const issues: string[] = [];

  // `meta.num_calls` is what a caption states and the pools are what the rows
  // are drawn from. Not equality: `meta.num_calls` counts every invocation the
  // cost log holds, while `pools` is built by walking the *sampled* rows, so a
  // pool whose iterations the stride never landed on is counted in the caption
  // and absent from the list. The panel says how many those were rather than
  // refusing the report — which is what equality did, on a document the
  // producer emits.
  const counted = wire.pools.reduce((total, pool) => total + pool.num_calls, 0);
  if (counted > wire.meta.num_calls) {
    issues.push(`meta: ${wire.meta.num_calls} invocations declared, but the pools hold ${counted}`);
  }

  const published = new Set<string>();
  for (const pool of wire.pools) {
    if (published.has(pool.pool)) {
      issues.push(`pools: pool "${clip(pool.pool)}" appears more than once`);
    }
    published.add(pool.pool);
    // A pool name is written straight into the address — the panel's rows are
    // links down to the pool — so a name the location parser will not read back
    // is a row that works once and 404s on the way home.
    if (!segmentSchema.safeParse({ at: 'pool', role: pool.pool }).success) {
      issues.push(`pools: pool name "${clip(pool.pool)}" cannot be put in an address`);
    }
    issues.push(...metricsIssues(`pools.${pool.pool}`, pool.num_calls, pool.metrics));
  }

  const identities = new Set<string>();
  for (const worker of wire.workers) {
    const identity = `${worker.pool_tag}/${worker.worker_id}`;
    if (identities.has(identity)) {
      issues.push(`workers: ${identity} appears more than once`);
    }
    identities.add(identity);
    if (!published.has(worker.pool_tag)) {
      issues.push(
        `workers: ${identity} names pool "${clip(worker.pool_tag)}", which pools does not publish`,
      );
    }
    issues.push(...metricsIssues(`workers.${identity}`, worker.num_calls, worker.metrics));
  }
  if (issues.length > 0) return issues;

  // A pool's rows and its workers' rows are bucketed from the same pass over
  // the same cost log, so both counts partition exactly. The panel puts one
  // above the other, and a pool that held more invocations than its workers is
  // a pool with a worker missing — which the panel cannot see, because a short
  // list looks like a small pool.
  for (const pool of wire.pools) {
    const own = wire.workers.filter((worker) => worker.pool_tag === pool.pool);
    if (own.length === 0) continue;
    const invocations = own.reduce((total, worker) => total + worker.num_calls, 0);
    // Same asymmetry as the caption above: a worker the stride stepped over is
    // absent from `workers` and counted in its pool's total.
    if (invocations > pool.num_calls) {
      issues.push(
        `pools: "${pool.pool}" ran ${pool.num_calls} invocations, but its workers ran ${invocations}`,
      );
    }
    const sampled = own.reduce((total, worker) => total + worker.metrics.batch_tokens.n, 0);
    if (sampled !== pool.metrics.batch_tokens.n) {
      issues.push(
        `pools: "${pool.pool}" sampled ${pool.metrics.batch_tokens.n} invocations, but its workers sampled ${sampled}`,
      );
    }
  }
  return issues;
}

/** The relations between one scope's three distributions. */
function metricsIssues(where: string, invocations: number, metrics: WireMetrics): string[] {
  const issues: string[] = [];
  const named: readonly (readonly [string, WireMetric])[] = [
    ['batch_tokens', metrics.batch_tokens],
    ['prefill_tokens', metrics.prefill_tokens],
    ['decode_request_count', metrics.decode_request_count],
  ];
  for (const [name, metric] of named) {
    issues.push(...metricIssues(`${where}.${name}`, invocations, metric));
  }
  if (issues.length > 0) return issues;

  // All three come from one pass over one set of rows, and the columns are
  // non-nullable `u32` at the source, so nothing can be filtered out of one and
  // not the others. A differing count means the three are not describing the
  // same invocations — and everything below compares them as if they were.
  const counts = named.map(([, metric]) => metric.n);
  if (new Set(counts).size > 1) {
    issues.push(
      `${where}: the three metrics cover ${counts.join(', ')} invocations, so they are not the same ones`,
    );
    return issues;
  }

  const { batch_tokens: batch, prefill_tokens: prefill, decode_request_count: decode } = metrics;
  if (batch.mean === null || prefill.mean === null || decode.mean === null) return issues;
  // Row-wise `batch = prefill + decode_query_rows`, and query rows are at least
  // the request count. So the means bound this way round, with the excess being
  // speculative draft rows. See the header.
  const components = prefill.mean + decode.mean;
  if (batch.mean + tolerance(components) < components) {
    issues.push(
      `${where}: batches average ${batch.mean} tokens, below the ${components} its own prefill and decode counts require`,
    );
  }
  // And row-wise `batch >= prefill` and `batch >= decode_requests`, so the
  // largest batch is at least the largest of either.
  for (const [name, metric] of named.slice(1)) {
    if (batch.max !== null && metric.max !== null && batch.max + ABSOLUTE_TOLERANCE < metric.max) {
      issues.push(
        `${where}: the largest batch held ${batch.max} tokens, below the ${metric.max} of its own ${name}`,
      );
    }
  }
  return issues;
}

/** One distribution's own shape. */
function metricIssues(where: string, invocations: number, metric: WireMetric): string[] {
  const issues: string[] = [];
  const figures = [metric.mean, metric.p50, metric.p90, metric.p99, metric.max];
  // Present together or absent together: they are one `stats()` call, which
  // answers `None` for every figure when the sample is empty. A distribution
  // with a maximum and no median is not one this build can read, and filling
  // the hole would be inventing a percentile.
  if (figures.some((figure) => figure === null) && figures.some((figure) => figure !== null)) {
    issues.push(`${where}: some of the distribution is missing and some is not`);
    return issues;
  }
  if (metric.mean === null) {
    if (metric.n !== 0) issues.push(`${where}: ${metric.n} samples with no distribution`);
    return issues;
  }
  if (metric.n === 0) {
    issues.push(`${where}: a distribution over no samples`);
    return issues;
  }
  // The distribution is over a regular stride through the run's iterations, so
  // it covers at most the invocations there were.
  if (metric.n > invocations) {
    issues.push(`${where}: ${metric.n} sampled out of ${invocations} invocations`);
  }
  // One sorted array, read at three positions and at its end.
  const ascending: readonly (readonly [string, number])[] = [
    ['p50', metric.p50 ?? 0],
    ['p90', metric.p90 ?? 0],
    ['p99', metric.p99 ?? 0],
    ['max', metric.max ?? 0],
  ];
  for (let at = 1; at < ascending.length; at += 1) {
    const [name, value] = ascending[at];
    const [before, lower] = ascending[at - 1];
    if (value + ABSOLUTE_TOLERANCE < lower) {
      issues.push(`${where}: ${name} ${value} is below ${before} ${lower}`);
    }
  }
  if (metric.max !== null && metric.mean > metric.max + ABSOLUTE_TOLERANCE) {
    issues.push(`${where}: mean ${metric.mean} is above the largest sample ${metric.max}`);
  }
  return issues;
}

function tolerance(against: number): number {
  return ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(against);
}

/** Enough of an over-long name to recognise it by, without printing all of it. */
function clip(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}
