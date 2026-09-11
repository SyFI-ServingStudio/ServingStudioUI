/**
 * How full the KV cache ran, schema 1 — the *report*, not the series.
 *
 * The payload is 200 bins × four token levels × three across-shard views × every
 * shard; this is the peak of each of those levels, per KV pool. A reader opens
 * it to find out whether the run was short of memory, and the peak is the
 * answer — an average occupancy says nothing about the moment admission stalled.
 *
 * ## The distinction the whole panel is for
 *
 * `active` is what was actually resident. `projected` is the admission gate's
 * estimate of what the requests it has already admitted will eventually need,
 * and the Analyzer deliberately does not clamp it to capacity
 * (`kv/occupancy.rs`), because it exceeding capacity is the signal: the admitted
 * horizon outruns the pool, and the gate will stall or preempt. A run at 30%
 * resident and 120% projected is admission-limited with memory to spare, which
 * is a different problem from a full cache and has a different fix. No other
 * subject on the page can tell those apart.
 *
 * ## Zero is not the same as unrecorded
 *
 * `retained_prefix_kv` was added to the simulator's stream after the fact. Older
 * runs are still analyzable, and their breakdown arrives **zero-filled** with
 * `has_retained_prefix_breakdown: false` beside it. Read as a number that is
 * exactly what a run with no prefix cache would report. So the parser turns the
 * whole level into `null` at this boundary: a panel downstream cannot then draw
 * "0 tokens of prefix cache" for a run that never measured any, because there is
 * no number there to draw.
 *
 * ## What is cross-checked, and why these
 *
 * Every level is published twice — as the peak of the across-shard mean and as
 * the peak of the across-shard max — and every token figure is published again
 * as a fraction of capacity. Those are not independent: the max series dominates
 * the mean series bin by bin, the prefix cache is a component of what is
 * resident, and a fraction is a division this build can redo. Each of them is a
 * chance for one number to be attributed to the wrong level, which renders as a
 * perfectly plausible memory report.
 *
 * Everything here is a pure function of a parsed body.
 */
import { z } from 'zod';

import { segmentSchema } from '../../location';
import {
  type KvOccupancyTimeline,
  type KvSeries,
  type KvTimelineBand,
  type RunKvOccupancy,
} from '../ref';

export const KV_OCCUPANCY_SCHEMA_VERSION = 1;

/**
 * How far a fraction may sit from the division it came from.
 *
 * The fractions are `tokens / capacity` in f64, where the tokens are means of
 * means and the capacity is an integer of order 10^6 — so the round trip is
 * exact to within a few ulps of a number near 1. Relative, with an absolute
 * floor for the pools that held nothing.
 */
const RELATIVE_TOLERANCE = 1e-9;
const ABSOLUTE_TOLERANCE = 1e-12;

/** Token counts are compared to each other, where a few ulps of a big f64 is a
 * bigger absolute number than the fraction case above. */
const TOKEN_TOLERANCE = 1e-6;

/** Raised when the body parses but says something impossible. */
export class IncompatibleKvOccupancyError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`kv-occupancy artifact is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleKvOccupancyError';
  }
}

/**
 * Raised when the analysis says it has nothing.
 *
 * A run with no KV pool at all reaches this, and so does one with KV logging
 * switched off. Neither is a failure: the reader's next step is a simulator
 * setting, or nothing at all.
 */
export class UnavailableKvOccupancyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableKvOccupancyError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().safe();
/** A fraction of capacity, or `null` when this pool published no capacity.
 * Never bounded above: see the projection, in the header. */
const fraction = nonNegative.nullable();

const seriesSchema = z
  .object({
    pool_tag: nonEmpty,
    group_id: count,
    capacity_tokens: count.nullable(),
    n_workers: count.positive(),
    peak_active_mean_tokens: nonNegative,
    peak_active_mean_pct: fraction,
    peak_active_max_tokens: nonNegative,
    peak_active_max_pct: fraction,
    mean_active_pct: fraction,
    peak_retained_prefix_mean_tokens: nonNegative,
    peak_retained_prefix_mean_pct: fraction,
    peak_retained_prefix_max_tokens: nonNegative,
    peak_retained_prefix_max_pct: fraction,
    peak_projected_mean_tokens: nonNegative,
    peak_projected_mean_pct: fraction,
    // No `peak_projected_max_tokens` beside it. Mirrored rather than completed:
    // see `KvProjection`.
    peak_projected_max_pct: fraction,
    peak_promised_max_tokens: nonNegative,
    peak_promised_max_pct: fraction,
  })
  .strict();

const reportSchema = z.object({
  schema_version: z.literal(KV_OCCUPANCY_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z
    .object({
      num_series: count.positive(),
      num_bins: count.positive(),
      bin_width_ms: nonNegative,
      span_ms: finite.positive(),
      has_capacity: z.boolean(),
      has_retained_prefix_breakdown: z.boolean(),
    })
    .passthrough(),
  totals: z.object({ per_series: z.array(seriesSchema).nonempty() }),
  definitions: z.record(nonEmpty),
});

/** The unavailable form, spelled as the Analyzer spells it. */
const unavailableSchema = z.object({
  schema_version: z.literal(KV_OCCUPANCY_SCHEMA_VERSION),
  available: z.literal(false),
  reason: nonEmpty,
});

/** The version the body claims, when it claims one at all. */
export function kvOccupancyVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function parseKvOccupancy(body: unknown): RunKvOccupancy {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableKvOccupancyError(unavailable.data.reason);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleKvOccupancyError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      kvOccupancyVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = reportIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleKvOccupancyError(issues, KV_OCCUPANCY_SCHEMA_VERSION);
  }
  const measured = wire.meta.has_retained_prefix_breakdown;
  return {
    series: wire.totals.per_series.map((series): KvSeries => ({
      poolTag: series.pool_tag,
      groupId: series.group_id,
      // Built here rather than taken from the wire's `label`: the report's
      // `totals` does not carry one, and a name assembled in two places is a
      // name that will disagree with itself.
      label:
        groupsOf(wire, series.pool_tag) > 1
          ? `${series.pool_tag} · g${series.group_id}`
          : series.pool_tag,
      capacityTokens: series.capacity_tokens,
      workers: series.n_workers,
      active: {
        meanTokens: series.peak_active_mean_tokens,
        meanFraction: fractionOf(series, series.peak_active_mean_pct),
        maxTokens: series.peak_active_max_tokens,
        maxFraction: fractionOf(series, series.peak_active_max_pct),
      },
      // `null`, not a level of zeros: an old run's compatibility column is
      // indistinguishable from a run that genuinely cached no prefixes, and
      // only one of those is a fact.
      retainedPrefix: measured
        ? {
            meanTokens: series.peak_retained_prefix_mean_tokens,
            meanFraction: fractionOf(series, series.peak_retained_prefix_mean_pct),
            maxTokens: series.peak_retained_prefix_max_tokens,
            maxFraction: fractionOf(series, series.peak_retained_prefix_max_pct),
          }
        : null,
      projected: {
        meanTokens: series.peak_projected_mean_tokens,
        meanFraction: fractionOf(series, series.peak_projected_mean_pct),
        maxFraction: fractionOf(series, series.peak_projected_max_pct),
      },
      promised: {
        maxTokens: series.peak_promised_max_tokens,
        maxFraction: fractionOf(series, series.peak_promised_max_pct),
      },
      meanActiveFraction: fractionOf(series, series.mean_active_pct),
    })),
    window: {
      spanMs: wire.meta.span_ms,
      bins: wire.meta.num_bins,
      binWidthMs: wire.meta.bin_width_ms,
    },
    definitions: wire.definitions,
  };
}

/*
 * Complete payload schema. The previous refactor read only the report, while
 * the existing chart consumed this time series. Keep every field emitted by
 * `analyzer/rust/src/kv/occupancy.rs`; otherwise Zod silently strips data that
 * later panels cannot recover.
 */
const payloadBandSchema = z.object({
  mean: z.array(nonNegative),
  min: z.array(nonNegative),
  max: z.array(nonNegative),
});

const payloadWorkerIdSchema = z.union([nonEmpty, count.transform((workerId) => String(workerId))]);

const payloadWorkerSchema = z.object({
  worker_id: payloadWorkerIdSchema,
  active_tokens: z.array(nonNegative),
  retained_prefix_tokens: z.array(nonNegative).optional(),
  projected_tokens: z.array(nonNegative),
  promised_tokens: z.array(nonNegative),
});

const payloadSeriesSchema = z.object({
  key: nonEmpty,
  label: nonEmpty,
  pool_tag: nonEmpty,
  group_id: count,
  capacity_tokens: count.nullable(),
  n_workers: count.positive(),
  // Worker detail was added within schema v1. Aggregate-only artifacts remain
  // readable and still reproduce the original pool-average chart.
  workers: z.array(payloadWorkerSchema).optional(),
  active: payloadBandSchema,
  retained_prefix: payloadBandSchema.optional(),
  projected: payloadBandSchema,
  promised: payloadBandSchema,
});

const payloadSchema = z.object({
  schema_version: z.literal(KV_OCCUPANCY_SCHEMA_VERSION),
  meta: z.object({
    log_dir: nonEmpty,
    unit: z.literal('KV tokens (per shard); fraction = tokens / capacity_tokens'),
    has_capacity: z.boolean(),
    has_retained_prefix_breakdown: z.boolean().optional().default(false),
  }),
  t_start_ms: z.array(nonNegative).min(1),
  t_end_ms: z.array(nonNegative).min(1),
  series: z.array(payloadSeriesSchema).min(1),
  definitions: z.record(nonEmpty).default({}),
});

const unavailablePayloadSchema = z.object({
  schema_version: z.literal(KV_OCCUPANCY_SCHEMA_VERSION),
  meta: z.object({
    log_dir: nonEmpty,
    available: z.literal(false),
    reason: nonEmpty,
  }),
  t_start_ms: z.array(z.unknown()).length(0),
  t_end_ms: z.array(z.unknown()).length(0),
  series: z.array(z.unknown()).length(0),
});

type PayloadWire = z.infer<typeof payloadSchema>;
type PayloadBand = z.infer<typeof payloadBandSchema>;

/** Decode the complete KV payload used by the chart and worker drill-down. */
export function parseKvOccupancySeries(body: unknown): KvOccupancyTimeline {
  const unavailable = unavailablePayloadSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableKvOccupancyError(unavailable.data.meta.reason);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleKvOccupancyError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      kvOccupancyVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = payloadIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleKvOccupancyError(issues, KV_OCCUPANCY_SCHEMA_VERSION);
  }
  const retainedMeasured = wire.meta.has_retained_prefix_breakdown;
  return {
    tMs: wire.t_start_ms.map((start, index) => (start + wire.t_end_ms[index]) / 2),
    series: wire.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
      groupId: series.group_id,
      capacity: series.capacity_tokens,
      workerCount: series.n_workers,
      active: copyBand(series.active),
      retainedPrefix: retainedMeasured ? copyBand(series.retained_prefix!) : null,
      projected: copyBand(series.projected),
      promised: copyBand(series.promised),
    })),
    workerSeries: wire.series.flatMap((series) =>
      (series.workers ?? []).map((worker) => ({
        key: `${encodeURIComponent(series.key)}/${encodeURIComponent(worker.worker_id)}`,
        label: `${series.label}/${worker.worker_id}`,
        worker: { poolTag: series.pool_tag, workerId: worker.worker_id },
        groupId: series.group_id,
        capacity: series.capacity_tokens,
        active: [...worker.active_tokens],
        retainedPrefix: retainedMeasured ? [...worker.retained_prefix_tokens!] : null,
        projected: [...worker.projected_tokens],
        promised: [...worker.promised_tokens],
      })),
    ),
    sourceLogDir: wire.meta.log_dir,
    unit: wire.meta.unit,
    hasCapacity: wire.meta.has_capacity,
    hasRetainedPrefixBreakdown: retainedMeasured,
    definitions: wire.definitions,
  };
}

function copyBand(band: PayloadBand): KvTimelineBand {
  return { mean: [...band.mean], min: [...band.min], max: [...band.max] };
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
  if (wire.meta.has_capacity !== wire.series.some((series) => series.capacity_tokens !== null)) {
    issues.push('meta.has_capacity: does not match the series capacity_tokens values');
  }

  const seriesKeys = new Set<string>();
  const seriesIdentities = new Set<string>();
  const workers = new Set<string>();
  wire.series.forEach((series, seriesIndex) => {
    if (seriesKeys.has(series.key))
      issues.push(`series.${seriesIndex}.key: duplicate ${series.key}`);
    seriesKeys.add(series.key);
    const seriesIdentity = `${series.pool_tag}\u0000${series.group_id}`;
    if (seriesIdentities.has(seriesIdentity)) {
      issues.push(
        `series.${seriesIndex}: duplicate pool/group ${series.pool_tag}/g${series.group_id}`,
      );
    }
    seriesIdentities.add(seriesIdentity);
    if (series.workers !== undefined && series.workers.length !== series.n_workers) {
      issues.push(
        `series.${seriesIndex}.workers: has ${series.workers.length} workers, expected ${series.n_workers}`,
      );
    }
    for (const [name, band] of [
      ['active', series.active],
      ['projected', series.projected],
      ['promised', series.promised],
      ...(series.retained_prefix === undefined
        ? []
        : ([['retained_prefix', series.retained_prefix]] as const)),
    ] as const) {
      bandIssues(`series.${seriesIndex}.${name}`, band, points, issues);
    }
    if (wire.meta.has_retained_prefix_breakdown && series.retained_prefix === undefined) {
      issues.push(
        `series.${seriesIndex}.retained_prefix: missing while the breakdown is available`,
      );
    }
    if (wire.meta.has_retained_prefix_breakdown && series.retained_prefix !== undefined) {
      for (const view of ['mean', 'min', 'max'] as const) {
        series.retained_prefix[view].forEach((retained, bin) => {
          const active = series.active[view][bin];
          if (active !== undefined && retained > active + TOKEN_TOLERANCE) {
            issues.push(
              `series.${seriesIndex}.retained_prefix.${view}.${bin}: ${retained} exceeds active ${active}`,
            );
          }
        });
      }
    }
    (series.workers ?? []).forEach((worker, workerIndex) => {
      const key = `${seriesIdentity}\u0000${worker.worker_id}`;
      if (workers.has(key)) {
        issues.push(
          `series.${seriesIndex}.workers.${workerIndex}.worker_id: duplicate ${series.pool_tag}/${worker.worker_id}`,
        );
      }
      workers.add(key);
      for (const [name, values] of [
        ['active_tokens', worker.active_tokens],
        ['projected_tokens', worker.projected_tokens],
        ['promised_tokens', worker.promised_tokens],
      ] as const) {
        if (values.length !== points) {
          issues.push(
            `series.${seriesIndex}.workers.${workerIndex}.${name}: has ${values.length} points, expected ${points}`,
          );
        }
      }
      if (wire.meta.has_retained_prefix_breakdown) {
        if (worker.retained_prefix_tokens === undefined) {
          issues.push(
            `series.${seriesIndex}.workers.${workerIndex}.retained_prefix_tokens: missing while the breakdown is available`,
          );
        } else if (worker.retained_prefix_tokens.length !== points) {
          issues.push(
            `series.${seriesIndex}.workers.${workerIndex}.retained_prefix_tokens: has ${worker.retained_prefix_tokens.length} points, expected ${points}`,
          );
        } else if (
          worker.retained_prefix_tokens.some(
            (retained, bin) => retained > worker.active_tokens[bin] + TOKEN_TOLERANCE,
          )
        ) {
          issues.push(
            `series.${seriesIndex}.workers.${workerIndex}.retained_prefix_tokens: exceeds active_tokens`,
          );
        }
      }
    });
    if (series.workers !== undefined && series.workers.length > 0) {
      aggregateIssues(series, seriesIndex, wire.meta.has_retained_prefix_breakdown, issues);
    }
  });
  return issues;
}

function aggregateIssues(
  series: PayloadWire['series'][number],
  seriesIndex: number,
  retainedMeasured: boolean,
  issues: string[],
): void {
  const workers = series.workers ?? [];
  const compare = (
    name: string,
    band: PayloadBand,
    valuesOf: (worker: (typeof workers)[number]) => readonly number[] | undefined,
  ) => {
    for (let bin = 0; bin < band.mean.length; bin += 1) {
      const values = workers.map((worker) => valuesOf(worker)?.[bin]);
      if (values.some((value) => value === undefined)) continue;
      const numeric = values as number[];
      const expected = {
        mean: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
        min: Math.min(...numeric),
        max: Math.max(...numeric),
      };
      for (const view of ['mean', 'min', 'max'] as const) {
        const actual = band[view][bin];
        if (actual !== undefined && !near(actual, expected[view])) {
          issues.push(
            `series.${seriesIndex}.${name}.${view}.${bin}: ${actual} does not match worker aggregate ${expected[view]}`,
          );
        }
      }
    }
  };
  compare('active', series.active, (worker) => worker.active_tokens);
  compare('projected', series.projected, (worker) => worker.projected_tokens);
  compare('promised', series.promised, (worker) => worker.promised_tokens);
  if (retainedMeasured && series.retained_prefix !== undefined) {
    compare('retained_prefix', series.retained_prefix, (worker) => worker.retained_prefix_tokens);
  }
}

function bandIssues(path: string, band: PayloadBand, points: number, issues: string[]): void {
  for (const [name, values] of Object.entries(band)) {
    if (values.length !== points) {
      issues.push(`${path}.${name}: has ${values.length} points, expected ${points}`);
    }
  }
  for (let index = 0; index < points; index += 1) {
    const min = band.min[index];
    const mean = band.mean[index];
    const max = band.max[index];
    if (min !== undefined && mean !== undefined && min > mean + TOKEN_TOLERANCE) {
      issues.push(`${path}.${index}: min ${min} exceeds mean ${mean}`);
    }
    if (mean !== undefined && max !== undefined && mean > max + TOKEN_TOLERANCE) {
      issues.push(`${path}.${index}: mean ${mean} exceeds max ${max}`);
    }
  }
}

type Wire = z.infer<typeof reportSchema>;
type WireSeries = z.infer<typeof seriesSchema>;

/**
 * A published fraction, or `null` when the zero on the wire is not a fraction.
 *
 * The producer divides by a declared capacity of zero to zero rather than to
 * infinity — a fallback so the JSON stays finite, not a measurement. Read
 * literally, a pool holding a quarter of a million tokens against a declared
 * capacity of nothing renders as 0% occupancy, perfectly balanced shards and no
 * over-commitment: the emptiest, healthiest pool in the run.
 *
 * So a zero capacity is dropped to the same "no fraction here" the absent one
 * gives, which the panel already knows how to show — token counts, no
 * percentages, and no conclusion about headroom. The capacity itself is kept as
 * the zero it was, because "declared as zero" and "not recorded" are different
 * things to tell a reader.
 */
function fractionOf(series: WireSeries, pct: number | null): number | null {
  return series.capacity_tokens === null || series.capacity_tokens === 0 ? null : pct;
}

function groupsOf(wire: Wire, poolTag: string): number {
  return wire.totals.per_series.filter((series) => series.pool_tag === poolTag).length;
}

function reportIssues(wire: Wire): string[] {
  const issues: string[] = [];
  const all = wire.totals.per_series;

  // The window has to be the one the bins were taken over.
  if (!near(wire.meta.bin_width_ms, wire.meta.span_ms / wire.meta.num_bins)) {
    issues.push(
      `meta: ${wire.meta.num_bins} bins of ${wire.meta.bin_width_ms} ms do not span ${wire.meta.span_ms} ms`,
    );
  }
  // `meta` is what a caption counts and the array is what the rows are drawn
  // from.
  if (wire.meta.num_series !== all.length) {
    issues.push(`meta: ${wire.meta.num_series} series declared, ${all.length} listed`);
  }
  // One direction only. `has_capacity` says *some* pool declared one, so a
  // series may still be without; but if none did, none may claim one.
  if (!wire.meta.has_capacity && all.some((series) => series.capacity_tokens !== null)) {
    issues.push('meta: has_capacity is false, but a series declares a capacity');
  }

  const seen = new Set<string>();
  for (const series of all) {
    const identity = `${series.pool_tag}/g${series.group_id}`;
    if (seen.has(identity)) {
      issues.push(`totals.per_series: ${identity} appears more than once`);
    }
    seen.add(identity);
    // A pool tag becomes a path segment the moment a reader opens its row.
    if (!segmentSchema.safeParse({ at: 'pool', role: series.pool_tag }).success) {
      issues.push(
        `totals.per_series: pool tag "${clip(series.pool_tag)}" cannot be put in an address`,
      );
    }
    issues.push(...levelIssues(identity, series));
  }
  return issues;
}

/**
 * The relations between one series' four levels.
 *
 * Written out per level rather than as one loop over field names, because the
 * levels do not have the same fields — the projection publishes no worst-shard
 * token count and the reservation publishes no mean — and a loop would have to
 * carry a table of exceptions that is longer than the checks.
 */
function levelIssues(identity: string, series: WireSeries): string[] {
  const issues: string[] = [];
  const capacity = series.capacity_tokens;

  // Every fraction on this series, whether or not the report publishes the token
  // count it was divided from.
  //
  // One list rather than a list of pairs and two loose fields beside it. The
  // producer runs *every* one of these through the same closure, so they share
  // the rule about when a fraction may exist at all — and the two without a
  // token pair were the two that ended up outside the loop and unchecked, which
  // is how a report claiming a 900% horizon on a pool of no capacity, and one
  // withholding the horizon on a pool that has one, were both accepted.
  const fractions: readonly (readonly [string, number | null, number | null])[] = [
    ['peak_active_mean', series.peak_active_mean_tokens, series.peak_active_mean_pct],
    ['peak_active_max', series.peak_active_max_tokens, series.peak_active_max_pct],
    [
      'peak_retained_prefix_mean',
      series.peak_retained_prefix_mean_tokens,
      series.peak_retained_prefix_mean_pct,
    ],
    [
      'peak_retained_prefix_max',
      series.peak_retained_prefix_max_tokens,
      series.peak_retained_prefix_max_pct,
    ],
    ['peak_projected_mean', series.peak_projected_mean_tokens, series.peak_projected_mean_pct],
    // No token count published beside it — the analysis reports the worst
    // shard's horizon only as a fraction — but the same rule about existing.
    ['peak_projected_max', null, series.peak_projected_max_pct],
    ['peak_promised_max', series.peak_promised_max_tokens, series.peak_promised_max_pct],
    ['mean_active', null, series.mean_active_pct],
  ];
  for (const [name, tokens, pct] of fractions) {
    if (capacity === null) {
      // No capacity means no reference to be a fraction of, and a fraction that
      // appeared anyway would be against something this report does not name.
      if (pct !== null) {
        issues.push(`totals.per_series.${identity}.${name}_pct: no capacity to be a fraction of`);
      }
      continue;
    }
    if (pct === null) {
      issues.push(
        `totals.per_series.${identity}.${name}_pct: missing beside a capacity of ${capacity}`,
      );
      continue;
    }
    if (capacity === 0) {
      // The producer divides by a declared zero to zero rather than to
      // infinity, so a zero-capacity report is all zeroes whatever the tokens
      // were. Anything else did not come from this producer — and the zeroes
      // themselves are not occupancies, which is what `parseKvOccupancy` drops
      // them for.
      if (pct !== 0) {
        issues.push(
          `totals.per_series.${identity}.${name}_pct: ${pct} against a declared capacity of zero`,
        );
      }
      continue;
    }
    if (tokens === null) continue;
    const expected = tokens / capacity;
    if (!near(pct, expected)) {
      issues.push(
        `totals.per_series.${identity}.${name}: ${tokens} of ${capacity} tokens is ${expected}, not the stated ${pct}`,
      );
    }
  }

  // The worst single shard cannot be below the shards' average — the max series
  // dominates the mean series in every bin, and a peak preserves that. This is
  // the check that catches the two being swapped, which is otherwise invisible:
  // both are plausible occupancies and the smaller one is the reassuring one.
  const dominates: readonly (readonly [string, number, number])[] = [
    ['active', series.peak_active_max_tokens, series.peak_active_mean_tokens],
    [
      'retained_prefix',
      series.peak_retained_prefix_max_tokens,
      series.peak_retained_prefix_mean_tokens,
    ],
  ];
  for (const [level, max, mean] of dominates) {
    if (max + TOKEN_TOLERANCE < mean) {
      issues.push(
        `totals.per_series.${identity}: ${level} peaks at ${max} on its worst shard, below the ${mean} its shards averaged`,
      );
    }
  }
  if (
    series.peak_projected_max_pct !== null &&
    series.peak_projected_mean_pct !== null &&
    series.peak_projected_max_pct + RELATIVE_TOLERANCE < series.peak_projected_mean_pct
  ) {
    issues.push(
      `totals.per_series.${identity}: projected peaks at ${series.peak_projected_max_pct} on its worst shard, below the ${series.peak_projected_mean_pct} its shards averaged`,
    );
  }

  // And it cannot exceed the average by more than the shard count.
  //
  // Occupancies are non-negative, so in any single bin the largest shard is at
  // most `n` times their mean. The two peaks need not come from the same bin —
  // that is what makes their *difference* unreadable — but the bound survives
  // the maximum: whichever bin gave the worst shard, the mean in that bin was
  // at least a shard-count's fraction of it, and the peak of the means is at
  // least that. The check the one-shard case makes sharp: with `n_workers: 1`
  // the two views are the same series, so a report where they differ at all is
  // one where they are not what they say they are.
  const bounded: readonly (readonly [string, number | null, number | null])[] = [
    ['active', series.peak_active_max_pct, series.peak_active_mean_pct],
    ['retained prefix', series.peak_retained_prefix_max_pct, series.peak_retained_prefix_mean_pct],
    ['projected', series.peak_projected_max_pct, series.peak_projected_mean_pct],
  ];
  for (const [level, max, mean] of bounded) {
    if (max === null || mean === null) continue;
    const ceiling = mean * series.n_workers;
    if (max > ceiling + ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * ceiling) {
      issues.push(
        `totals.per_series.${identity}: ${level} peaks at ${max} on one of ${series.n_workers} shards, above the ${ceiling} that averaging ${mean} allows`,
      );
    }
  }

  // The same bound on the token counts, which is where it has to be for it to
  // apply at all: every fraction above is null when the run declared no KV
  // capacity, and null when it declared zero — so on those runs the loop above
  // checks nothing, and those are exactly the runs whose panel shows token
  // counts and no percentages. The tokens are always published.
  //
  // `projected` has no token-denominated maximum to check, so it stays in the
  // fraction loop alone and goes unchecked on a capacity-less run.
  const boundedTokens: readonly (readonly [string, number, number])[] = [
    ['active', series.peak_active_max_tokens, series.peak_active_mean_tokens],
    [
      'retained_prefix',
      series.peak_retained_prefix_max_tokens,
      series.peak_retained_prefix_mean_tokens,
    ],
  ];
  for (const [level, max, mean] of boundedTokens) {
    const ceiling = mean * series.n_workers;
    if (max > ceiling + TOKEN_TOLERANCE) {
      issues.push(
        `totals.per_series.${identity}: ${level} peaks at ${max} tokens on one of ${series.n_workers} shards, above the ${ceiling} that averaging ${mean} allows`,
      );
    }
  }

  // The prefix cache is a *component* of what is resident, so it cannot be more
  // of it than there was. A run whose prefix cache exceeded its own occupancy
  // would draw a breakdown with a negative remainder.
  const components: readonly (readonly [string, number, number])[] = [
    ['mean', series.peak_retained_prefix_mean_tokens, series.peak_active_mean_tokens],
    ['max', series.peak_retained_prefix_max_tokens, series.peak_active_max_tokens],
  ];
  for (const [view, prefix, active] of components) {
    if (prefix > active + TOKEN_TOLERANCE) {
      issues.push(
        `totals.per_series.${identity}: ${view} retained prefix ${prefix} exceeds the ${active} tokens resident`,
      );
    }
  }

  // The average occupancy is over a subset of the same series the peak is the
  // maximum of, so it cannot be above it.
  if (
    series.mean_active_pct !== null &&
    series.peak_active_mean_pct !== null &&
    series.mean_active_pct > series.peak_active_mean_pct + RELATIVE_TOLERANCE
  ) {
    issues.push(
      `totals.per_series.${identity}: mean occupancy ${series.mean_active_pct} is above the peak ${series.peak_active_mean_pct}`,
    );
  }
  return issues;
}

/** Equal to within what an f64 division and its inverse can differ by. */
function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(right);
}

/** Enough of an over-long token to recognise it by, without printing all of it. */
function clip(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}
