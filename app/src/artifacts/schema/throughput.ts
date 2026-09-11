/**
 * What the run delivered, schema 1 — the `report`.
 *
 * The producer (`analyzer/rust/src/throughput/segment.rs`) reads one aggregate
 * row per `request_state` snapshot tick, each carrying the cumulative prefill
 * and decode token counts across the admitted set. A segment is the difference
 * between two consecutive ticks divided by the interval between them. So the
 * segments are not samples: they partition the window between the first and
 * last snapshot, and their token sums are the totals. What the counters already
 * held at the first snapshot is in none of them — the producer differences
 * consecutive snapshots and never adds the first one's cumulative value — so
 * these are the tokens processed *across the measured intervals*, which is not
 * quite the same claim as "everything the run did".
 *
 * ## Why this subject exists next to the overview
 *
 * The overview leads with one number, `total_tps`, and that number hides two
 * things a reader acts on.
 *
 * It is an **average over the window**. A run that served 2,000 tok/s for half
 * the time and 560 for the other half reports the same 1,280 as one that never
 * moved off 1,280, and only the segments can tell them apart.
 *
 * And it is a **sum across two kinds of token**. `total_tps = prefill_tps +
 * decode_tps` is the producer's own definition, and the two terms are not the
 * same work: a prefill token is one token of context put through a batched
 * matmul, a decode token is one token generated a step at a time. A deployment
 * at 1,024 prefill + 256 decode and one at 256 + 1,024 report the same total
 * and are not doing the same thing.
 *
 * ## What is checked, and why each one is checkable
 *
 * Every invariant below is a property of how `build_segments` computes, not a
 * hope about the data:
 *
 * - Segments have positive width — the producer skips any interval with
 *   `dt <= 0` rather than emitting it.
 * - Segments are contiguous and ordered — they are `windows(2)` over a sorted
 *   boundary list, so each one's end is the next one's start.
 * - `total = prefill + decode` per segment, and `x_per_gpu = x / num_gpus`,
 *   both by construction.
 * - The totals are the segments: `Σ rate × dt` over the segments is the token
 *   total, because that sum is literally how the producer accumulates them.
 *   This is the one check that ties the two halves of the document together —
 *   a report whose headline rate disagrees with its own series is describing
 *   two different runs.
 * - The segments cover `span_ms`. The span is `last tick − first tick` and the
 *   segments are the intervals between those same ticks, so the two are one
 *   measurement written twice. Without this a report can publish a window
 *   wider than anything it measured, and every rate derived from the span —
 *   including the average the panel calls the run's own — is then an average
 *   over time nobody looked at.
 * - The counts in `meta` match the arrays they count.
 *
 * Rates are *not* required to be equal across segments, or to equal the run
 * average. That they are not is the finding this panel exists to show.
 *
 * ## The one gap left open on purpose
 *
 * The bins are checked against `span_ms` and against the segments' end, but
 * *not* against the segments' token total, so bins describing a different
 * amount of work are accepted here. That is deliberate: the two views come
 * apart in valid producer output. `build_segments` drops any interval with
 * `dt <= 0`, while the bin edges come from `interp_cum` over the raw tick
 * list — so two snapshots sharing a timestamp lose their tokens from the fine
 * view and keep them in the coarse one. Ticks at `(0, 0)`, `(1000, 100)`,
 * `(1000, 200)`, `(2000, 300)` publish 200 tokens of segments beside 300 of
 * bins, and both are what the producer meant. A conservation check across the
 * views would refuse that document. What is lost is that doubling every bin
 * rate parses; what is kept is that the numbers on screen — which come from
 * the segments — stay tied to the totals printed above them.
 *
 * Everything here is a pure function of a parsed body.
 */
import { z } from 'zod';

import type {
  RunThroughput,
  ThroughputRate,
  ThroughputSegment,
  ThroughputTimeline,
  ThroughputTimelineView,
} from '../ref';

export const RUN_THROUGHPUT_SCHEMA_VERSION = 1;

/**
 * How far a derived figure may miss by.
 *
 * Purely relative. Every quantity checked here is a sum or a product of
 * non-negative measurements — token counts and durations — so there is no
 * cancellation to inflate a small difference, and a sum that should be zero is
 * exactly zero. An absolute floor would only widen the tolerance where the
 * quantities are smallest, which is where it is least justified.
 *
 * Wider than the 1e-9 the other subjects use, because these figures survive a
 * division and a multiplication apiece: the producer divides a token count by
 * an interval to publish a rate, and this check multiplies it back.
 */
const RELATIVE_TOLERANCE = 1e-6;

/** Raised when the body parses but says something impossible. */
export class IncompatibleRunThroughputError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(
      `throughput artifact is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'IncompatibleRunThroughputError';
  }
}

/**
 * Raised when the analysis says it has nothing.
 *
 * Two reasons reach this and both are ordinary: a run with no
 * `request_state.parquet`, and a run with fewer than two snapshot ticks, which
 * has no interval to difference. Neither is a failure of the read.
 */
export class UnavailableRunThroughputError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableRunThroughputError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const rate = finite.nonnegative();

const segmentSchema = z
  .object({
    t_start_ms: finite,
    t_end_ms: finite,
    prefill_tps: rate,
    decode_tps: rate,
    total_tps: rate,
    prefill_tps_per_gpu: rate,
    decode_tps_per_gpu: rate,
    total_tps_per_gpu: rate,
  })
  .strict();

const reportSchema = z.object({
  schema_version: z.literal(RUN_THROUGHPUT_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z
    .object({
      num_gpus: z.number().int().positive(),
      // Empty when the sidecar named no GPU — which `read_run_meta` decides
      // separately from the count above, so an empty name says nothing about
      // where that count came from.
      gpu_name: z.string(),
      num_segments: z.number().int().nonnegative(),
      num_bins: z.number().int().nonnegative(),
      span_ms: finite.nonnegative(),
    })
    .passthrough(),
  totals: z
    .object({
      prefill_tokens: finite.nonnegative(),
      decode_tokens: finite.nonnegative(),
      total_tokens: finite.nonnegative(),
      prefill_tps: rate,
      decode_tps: rate,
      total_tps: rate,
      total_tps_per_gpu: rate,
    })
    .strict(),
  segments: z.array(segmentSchema).nonempty(),
  binned_segments: z.array(segmentSchema),
  definitions: z.record(nonEmpty),
});

/** The unavailable form, spelled as the Analyzer spells it. */
const unavailableSchema = z.object({
  schema_version: z.literal(RUN_THROUGHPUT_SCHEMA_VERSION),
  available: z.literal(false),
  reason: nonEmpty,
});

/** The version the body claims, when it claims one at all. */
export function runThroughputVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function parseRunThroughput(body: unknown): RunThroughput {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableRunThroughputError(unavailable.data.reason);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRunThroughputError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      runThroughputVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = reportIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleRunThroughputError(issues, RUN_THROUGHPUT_SCHEMA_VERSION);
  }
  const gpus = wire.meta.num_gpus;
  return {
    total: rateOf(wire.totals.total_tokens, wire.totals.total_tps, gpus),
    prefill: rateOf(wire.totals.prefill_tokens, wire.totals.prefill_tps, gpus),
    decode: rateOf(wire.totals.decode_tokens, wire.totals.decode_tps, gpus),
    segments: wire.segments.map(segmentOf),
    spanSeconds: wire.meta.span_ms / 1000,
    gpus,
    // Missing name, not missing hardware. `read_run_meta` takes the count from
    // `num_gpus` and the name from `gpus[0].name`, so `{"num_gpus": 4}` yields
    // four GPUs and no name — the rates *were* divided, by four. The absent
    // sidecar lands here too, as one GPU and no name, and nothing in the
    // document separates the two. So this carries only what is knowable: the
    // name is unavailable. Whether `gpus` was read or assumed is not derivable
    // from it, and the panel says nothing that would need it to be.
    gpuName: wire.meta.gpu_name === '' ? null : wire.meta.gpu_name,
    bins: wire.binned_segments.length,
    definitions: wire.definitions,
  };
}

const timelineSeriesSchema = z.object({
  key: nonEmpty,
  label: nonEmpty,
  per_gpu: z.array(rate),
});

const timelineViewSchema = z.object({
  t_start_ms: z.array(finite.nonnegative()),
  t_end_ms: z.array(finite.nonnegative()),
  series: z.array(timelineSeriesSchema).min(3),
});

const timelineSchema = z.object({
  schema_version: z.literal(RUN_THROUGHPUT_SCHEMA_VERSION),
  meta: z.object({
    gpu_name: z.string(),
    log_dir: nonEmpty,
    num_gpus: z.number().int().positive(),
    unit: z.literal('tokens/s per GPU'),
    avg_per_gpu: z.record(rate).optional().default({}),
  }),
  t_start_ms: timelineViewSchema.shape.t_start_ms,
  t_end_ms: timelineViewSchema.shape.t_end_ms,
  series: timelineViewSchema.shape.series,
  // Optional for minimal schema-v1 payload compatibility.
  coarse: timelineViewSchema.optional().nullable().default(null),
  definitions: z.record(nonEmpty).optional().default({}),
});

const unavailableTimelineSchema = z.object({
  schema_version: z.literal(RUN_THROUGHPUT_SCHEMA_VERSION),
  meta: z.object({ log_dir: nonEmpty, available: z.literal(false), reason: nonEmpty }),
  t_start_ms: z.array(z.unknown()).length(0),
  t_end_ms: z.array(z.unknown()).length(0),
  series: z.array(z.unknown()).length(0),
});

type TimelineWire = z.infer<typeof timelineSchema>;
type TimelineViewWire = z.infer<typeof timelineViewSchema>;

const TIMELINE_SERIES = ['total', 'prefill', 'decode'] as const;

/** Decode the fine and coarse per-GPU timelines used by the old throughput chart. */
export function parseThroughputSeries(body: unknown): ThroughputTimeline {
  const unavailable = unavailableTimelineSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableRunThroughputError(unavailable.data.meta.reason);
  const parsed = timelineSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRunThroughputError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      runThroughputVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = timelineIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleRunThroughputError(issues, RUN_THROUGHPUT_SCHEMA_VERSION);
  }
  if (wire.t_start_ms.length === 0) {
    throw new UnavailableRunThroughputError('no positive-width throughput intervals');
  }
  return {
    fine: timelineViewOf({
      t_start_ms: wire.t_start_ms,
      t_end_ms: wire.t_end_ms,
      series: wire.series,
    }),
    coarse: wire.coarse === null ? null : timelineViewOf(wire.coarse),
    sourceLogDir: wire.meta.log_dir,
    gpuName: wire.meta.gpu_name === '' ? null : wire.meta.gpu_name,
    gpus: wire.meta.num_gpus,
    unit: wire.meta.unit,
    averagesPerGpu: wire.meta.avg_per_gpu,
    definitions: wire.definitions,
  };
}

function timelineViewOf(wire: TimelineViewWire): ThroughputTimelineView {
  return {
    startMs: [...wire.t_start_ms],
    endMs: [...wire.t_end_ms],
    series: wire.series.map((series) => ({
      key: series.key,
      label: series.label,
      perGpu: [...series.per_gpu],
    })),
  };
}

function timelineIssues(wire: TimelineWire): string[] {
  const fine = {
    t_start_ms: wire.t_start_ms,
    t_end_ms: wire.t_end_ms,
    series: wire.series,
  };
  const issues = timelineViewIssues(fine, 'fine');
  if (wire.coarse !== null) {
    issues.push(...timelineViewIssues(wire.coarse, 'coarse'));
    if (wire.t_start_ms.length === 0 && wire.coarse.t_start_ms.length > 0) {
      issues.push('coarse: contains intervals while fine is empty');
    } else if (wire.t_start_ms.length > 0 && wire.coarse.t_start_ms.length === 0) {
      issues.push('coarse: is empty while fine contains intervals');
    } else if (
      wire.t_start_ms.length > 0 &&
      wire.coarse.t_start_ms.length > 0 &&
      (!near(wire.coarse.t_start_ms[0], wire.t_start_ms[0]) ||
        !near(wire.coarse.t_end_ms.at(-1) ?? 0, wire.t_end_ms.at(-1) ?? 0))
    ) {
      issues.push('coarse: must cover the same time window as fine');
    }
  }

  const averages = wire.meta.avg_per_gpu;
  if (Object.keys(averages).length > 0) {
    const byKey = new Map(wire.series.map((series) => [series.key, series]));
    TIMELINE_SERIES.forEach((key) => {
      const average = averages[key];
      if (average === undefined) {
        issues.push(`meta.avg_per_gpu: missing required ${key} average`);
        return;
      }
      const series = byKey.get(key);
      if (series === undefined) return;
      const widths = wire.t_start_ms.map((start, index) => wire.t_end_ms[index] - start);
      const span = widths.reduce((total, width) => total + width, 0);
      const weighted =
        span > 0
          ? series.per_gpu.reduce((total, value, index) => total + value * widths[index], 0) / span
          : 0;
      if (!near(average, weighted)) {
        issues.push(
          `meta.avg_per_gpu.${key}: ${average} does not match fine weighted mean ${weighted}`,
        );
      }
    });
  }
  return issues;
}

function timelineViewIssues(wire: TimelineViewWire, where: string): string[] {
  const issues: string[] = [];
  const points = wire.t_start_ms.length;
  if (wire.t_end_ms.length !== points) {
    issues.push(`${where}.t_end_ms: has ${wire.t_end_ms.length} points, expected ${points}`);
  }
  wire.t_start_ms.forEach((start, index) => {
    const end = wire.t_end_ms[index];
    if (end !== undefined && end <= start) {
      issues.push(`${where}.t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
    if (index > 0 && !near(start, wire.t_end_ms[index - 1])) {
      issues.push(`${where}.t_start_ms.${index}: must equal the previous bin end`);
    }
  });
  const keys = new Set<string>();
  wire.series.forEach((series, index) => {
    if (keys.has(series.key)) issues.push(`${where}.series.${index}.key: duplicate ${series.key}`);
    keys.add(series.key);
    if (series.per_gpu.length !== points) {
      issues.push(
        `${where}.series.${index}.per_gpu: has ${series.per_gpu.length} points, expected ${points}`,
      );
    }
  });
  const byKey = new Map(wire.series.map((series) => [series.key, series]));
  TIMELINE_SERIES.forEach((key) => {
    if (!byKey.has(key)) issues.push(`${where}.series: missing required ${key} series`);
  });
  const total = byKey.get('total');
  const prefill = byKey.get('prefill');
  const decode = byKey.get('decode');
  if (total && prefill && decode) {
    total.per_gpu.forEach((value, index) => {
      if (!near(value, prefill.per_gpu[index] + decode.per_gpu[index])) {
        issues.push(`${where}.series.total.per_gpu.${index}: must equal prefill + decode`);
      }
    });
  }
  return issues;
}

type Wire = z.infer<typeof reportSchema>;
type WireSegment = z.infer<typeof segmentSchema>;

function rateOf(tokens: number, perSecond: number, gpus: number): ThroughputRate {
  return { tokens, perSecond, perGpu: perSecond / gpus };
}

function segmentOf(segment: WireSegment): ThroughputSegment {
  return {
    startMs: segment.t_start_ms,
    endMs: segment.t_end_ms,
    prefillPerSecond: segment.prefill_tps,
    decodePerSecond: segment.decode_tps,
    totalPerSecond: segment.total_tps,
  };
}

/** Whether two figures agree to within the round trip that produced them. */
function near(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= RELATIVE_TOLERANCE * scale;
}

function reportIssues(wire: Wire): string[] {
  const issues: string[] = [];
  const gpus = wire.meta.num_gpus;

  issues.push(...segmentIssues(wire.segments, gpus, 'segments'));
  issues.push(...segmentIssues(wire.binned_segments, gpus, 'binned_segments'));

  // The counts a caption states against the arrays a reader scrolls. They are
  // written from the same `Vec` at the source, so a disagreement means the
  // report was assembled from two analyses.
  if (wire.meta.num_segments !== wire.segments.length) {
    issues.push(
      `meta.num_segments is ${wire.meta.num_segments} but ${wire.segments.length} segments were sent`,
    );
  }
  if (wire.meta.num_bins !== wire.binned_segments.length) {
    issues.push(
      `meta.num_bins is ${wire.meta.num_bins} but ${wire.binned_segments.length} bins were sent`,
    );
  }

  const totals = wire.totals;
  if (!near(totals.total_tokens, totals.prefill_tokens + totals.decode_tokens)) {
    issues.push(
      `totals.total_tokens is ${totals.total_tokens}, which is not prefill ${totals.prefill_tokens} plus decode ${totals.decode_tokens}`,
    );
  }
  if (!near(totals.total_tps, totals.prefill_tps + totals.decode_tps)) {
    issues.push(
      `totals.total_tps is ${totals.total_tps}, which is not prefill ${totals.prefill_tps} plus decode ${totals.decode_tps}`,
    );
  }
  if (!near(totals.total_tps_per_gpu * gpus, totals.total_tps)) {
    issues.push(
      `totals.total_tps_per_gpu ${totals.total_tps_per_gpu} across ${gpus} GPUs is not the total rate ${totals.total_tps}`,
    );
  }

  // The check that ties the halves together. `Σ rate × dt` over the segments is
  // how the producer accumulated the token totals in the first place, so a
  // report where the two disagree is one whose headline is not about its own
  // series — which is exactly the failure a reader cannot see, because the two
  // are never on screen in the same units.
  issues.push(...conservationIssues(wire));

  const last = wire.segments[wire.segments.length - 1];

  // The window the segments measured against the window the report claims. At
  // the source these are the same two ticks, and the segments between them are
  // contiguous (checked above), so this pins the measured time to the published
  // span rather than merely to its endpoints. Without it a report can carry one
  // second of measurement under a two-second span: the totals divide by the
  // span and come out at half the rate every one of its own segments shows, and
  // the panel reads that as a run that held a rate it never ran at.
  const measured = last.t_end_ms - wire.segments[0].t_start_ms;
  if (!near(measured, wire.meta.span_ms)) {
    issues.push(`segments cover ${measured}ms but meta.span_ms is ${wire.meta.span_ms}`);
  }

  // The two views are of one run. The bins are laid out edge to edge across the
  // whole tick range, and the last segment ends at the last tick, so both of
  // these hold by construction — and a report where they do not is one whose
  // trend view is a smoothing of some other window, which is invisible on
  // screen because the two are never drawn against the same axis.
  const bins = wire.binned_segments;
  if (bins.length > 0) {
    const covered = bins[bins.length - 1].t_end_ms - bins[0].t_start_ms;
    if (!near(covered, wire.meta.span_ms)) {
      issues.push(`binned_segments cover ${covered}ms but meta.span_ms is ${wire.meta.span_ms}`);
    }
    if (!near(bins[bins.length - 1].t_end_ms, last.t_end_ms)) {
      issues.push(
        `binned_segments end at ${bins[bins.length - 1].t_end_ms} and segments end at ${last.t_end_ms}`,
      );
    }
  }

  // A rate is tokens over a span, and the span is published. Checked last
  // because it fails for a second reason — a `span_ms` that is not the window
  // the segments cover — and the message has to name which.
  const span = wire.meta.span_ms / 1000;
  if (span > 0) {
    for (const [name, tokens, published] of [
      ['prefill', totals.prefill_tokens, totals.prefill_tps],
      ['decode', totals.decode_tokens, totals.decode_tps],
    ] as const) {
      if (!near(tokens / span, published)) {
        issues.push(
          `totals.${name}_tps is ${published}, but ${tokens} tokens over ${span}s is ${tokens / span}`,
        );
      }
    }
  }

  return issues;
}

function segmentIssues(
  segments: readonly WireSegment[],
  gpus: number,
  field: string,
): readonly string[] {
  const issues: string[] = [];
  let previousEnd: number | null = null;
  for (const [index, segment] of segments.entries()) {
    const at = `${field}[${index}]`;
    if (!(segment.t_end_ms > segment.t_start_ms)) {
      // The producer drops these rather than publishing them, so one here is
      // not a zero-length moment — it is a row that did not come from
      // `build_segments`, and its rate was divided by that width.
      issues.push(`${at} ends at ${segment.t_end_ms}, which is not after ${segment.t_start_ms}`);
    }
    if (previousEnd !== null && !near(segment.t_start_ms, previousEnd)) {
      issues.push(`${at} starts at ${segment.t_start_ms}, leaving a gap after ${previousEnd}`);
    }
    previousEnd = segment.t_end_ms;

    if (!near(segment.total_tps, segment.prefill_tps + segment.decode_tps)) {
      issues.push(
        `${at} totals ${segment.total_tps}, which is not prefill ${segment.prefill_tps} plus decode ${segment.decode_tps}`,
      );
    }
    for (const [name, whole, perGpu] of [
      ['prefill', segment.prefill_tps, segment.prefill_tps_per_gpu],
      ['decode', segment.decode_tps, segment.decode_tps_per_gpu],
      ['total', segment.total_tps, segment.total_tps_per_gpu],
    ] as const) {
      if (!near(perGpu * gpus, whole)) {
        issues.push(`${at} ${name} is ${whole} but ${perGpu} per GPU across ${gpus} GPUs`);
      }
    }
  }
  return issues;
}

function conservationIssues(wire: Wire): readonly string[] {
  const issues: string[] = [];
  for (const [name, published, rateOfSegment] of [
    ['prefill', wire.totals.prefill_tokens, (s: WireSegment) => s.prefill_tps],
    ['decode', wire.totals.decode_tokens, (s: WireSegment) => s.decode_tps],
  ] as const) {
    const summed = wire.segments.reduce(
      (total, segment) =>
        total + rateOfSegment(segment) * ((segment.t_end_ms - segment.t_start_ms) / 1000),
      0,
    );
    if (!near(summed, published)) {
      issues.push(`totals.${name}_tokens is ${published}, but the segments account for ${summed}`);
    }
  }
  return issues;
}
