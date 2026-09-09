import type {
  AlignmentCdfComparison,
  AlignmentE2eSeries,
  AlignmentWorkloadSeries,
  AlignmentWorkloadSide,
} from '../../domain/alignment';
import { fmtFixed, fmtLatencyMs, fmtPctPrecise, fmtRounded } from './format';

/**
 * §05 — the whole run, reduced to the numbers each card states.
 *
 * Everything arithmetic on this section lives here: percentiles, deltas, the
 * time fold behind every scheduler figure, and the axis tick choice. The
 * components below read these structures and place them; they compute nothing,
 * so a number can only be wrong in one file.
 *
 * Two rules the analyzer imposes and this module keeps:
 *
 *  - the two sides are never paired per request or per iteration. Every
 *    quantity is summarised inside one side and only then compared, which is
 *    why a "delta" here is always a ratio of two independent summaries.
 *  - a percentile whose measured value is zero has no ratio. That case reports
 *    `null` rather than an infinity dressed up as a large error.
 */

/** Sample quantile with linear interpolation between order statistics — the
 * convention the analyzer's own report uses, so a percentile derived from the
 * payload here agrees with the one it publishes. */
export function quantile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.min(lowerIndex + 1, sorted.length - 1);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  return lower + (upper - lower) * (rank - lowerIndex);
}

/** A ratio of two independently summarised sides, in percent. */
export function relativeDeltaPct(measured: number, simulated: number): number | null {
  if (!Number.isFinite(measured) || !Number.isFinite(simulated) || measured === 0) return null;
  return (simulated / measured - 1) * 100;
}

/** Round axis positions: the smallest of 1 / 2 / 2.5 / 5 × 10^k that divides
 * the span into at most `count` intervals. */
export function niceTicks(low: number, high: number, count: number): readonly number[] {
  const span = high - low;
  if (!(span > 0)) return [low];
  const raw = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((step) => step >= raw) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** The step `niceTicks` chose, for an axis that must place its own split
 * lines on the same positions ECharts computes from an interval. */
export function niceStep(low: number, high: number, count: number): number {
  const ticks = niceTicks(low, high, count);
  const [first, second] = ticks;
  return second === undefined ? Math.max(high - low, 1) : second - first;
}

/** A count, ready for `fmtInt`, which groups digits but does not round. */
export function roundToInteger(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : value;
}

/** Split a formatted quantity into its number and its unit, so a card can set
 * them in two sizes without owning a second rounding rule. */
export function splitFormatted(formatted: string): { value: string; unit: string } {
  const gap = formatted.indexOf(' ');
  if (gap < 0) return { value: formatted, unit: '' };
  return { value: formatted.slice(0, gap), unit: formatted.slice(gap + 1) };
}

// ---- latency --------------------------------------------------------------

/** What the design calls each latency comparison. The analyzer's own label
 * stays on the card as the sub-heading; these are the short forms the card
 * titles use, and an unknown key falls back to the analyzer label. */
const LATENCY_TITLES: Readonly<Record<string, string>> = {
  client_ttft: 'client TTFT',
  server_ttft: 'server TTFT',
  tpot: 'TPOT',
  server_tpot: 'server TPOT',
  e2e: 'E2E',
};

export interface LatencySide {
  readonly label: string;
  readonly n: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p99: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

export interface LatencyCardModel {
  readonly key: string;
  readonly title: string;
  readonly label: string;
  readonly unit: string;
  readonly n: number;
  readonly measured: LatencySide;
  readonly simulated: LatencySide;
  readonly deltaP50Pct: number | null;
  /** True when another card has the same simulated sample count and reported
   * percentiles. This does not establish that the underlying series is identical. */
  readonly sharesSimulatedSeries: boolean;
}

function latencySide(curve: AlignmentCdfComparison['measured']): LatencySide {
  return {
    label: curve.label,
    n: curve.n,
    p50: curve.markers.p50 ?? null,
    p90: curve.markers.p90 ?? null,
    p99: curve.markers.p99 ?? null,
    low: curve.x[0] ?? null,
    high: curve.x[curve.x.length - 1] ?? null,
  };
}

/** Compare summary values only; matching percentiles do not identify a series. */
function simulatedFingerprint(comparison: AlignmentCdfComparison): string {
  const { n, markers } = comparison.simulated;
  return [n, markers.p50, markers.p90, markers.p99].join('|');
}

export function latencyCards(
  comparisons: readonly AlignmentCdfComparison[],
): readonly LatencyCardModel[] {
  const fingerprintCounts = new Map<string, number>();
  for (const comparison of comparisons) {
    const fingerprint = simulatedFingerprint(comparison);
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
  }
  return comparisons.map((comparison) => {
    const measured = latencySide(comparison.measured);
    const simulated = latencySide(comparison.simulated);
    return {
      key: comparison.key,
      title: LATENCY_TITLES[comparison.key] ?? comparison.label,
      label: comparison.label,
      unit: comparison.unit,
      n: comparison.measured.n,
      measured,
      simulated,
      deltaP50Pct:
        measured.p50 === null || simulated.p50 === null
          ? null
          : relativeDeltaPct(measured.p50, simulated.p50),
      sharesSimulatedSeries: (fingerprintCounts.get(simulatedFingerprint(comparison)) ?? 0) > 1,
    };
  });
}

// ---- throughput -----------------------------------------------------------

export interface ThroughputSideModel {
  readonly tps: number | null;
  readonly spanMs: number | null;
  readonly peakBinTps: number;
  readonly outputTokens: number | null;
}

export interface ThroughputCardModel {
  readonly bins: number;
  readonly measured: ThroughputSideModel;
  readonly simulated: ThroughputSideModel;
  readonly deltaPct: number | null;
}

const maxOf = (values: readonly number[]): number =>
  values.reduce((highest, value) => Math.max(highest, value), 0);

export function throughputCard(series: AlignmentE2eSeries): ThroughputCardModel | null {
  const bins = series.throughput;
  if (bins === null || bins.tStartMs.length === 0) return null;
  const summary = series.throughputSummary;
  const measured: ThroughputSideModel = {
    tps: summary.measured_client_completion_tps ?? null,
    spanMs: summary.measured_client_completion_span_ms ?? null,
    peakBinTps: maxOf(bins.measuredOutputTps),
    outputTokens: summary.measured_output_tokens ?? null,
  };
  const simulated: ThroughputSideModel = {
    tps: summary.simulated_completion_tps ?? null,
    spanMs: summary.simulated_completion_span_ms ?? null,
    peakBinTps: maxOf(bins.simulatedOutputTps),
    outputTokens: summary.simulated_output_tokens ?? null,
  };
  return {
    bins: bins.tStartMs.length,
    measured,
    simulated,
    deltaPct:
      measured.tps === null || simulated.tps === null
        ? null
        : relativeDeltaPct(measured.tps, simulated.tps),
  };
}

// ---- scheduler shape ------------------------------------------------------

export type WorkloadMetricKey =
  'decodeBatchSize' | 'scheduledKvTokens' | 'prefillTokens' | 'iterationCycleMs';

export interface WorkloadMetricSpec {
  readonly key: WorkloadMetricKey;
  /** The analyzer's own name for the field, which is also its definition key. */
  readonly field: string;
  readonly label: string;
  readonly unit: string;
  /** The unit the figure's values carry, for formatting through `fmtQuantity`. */
  readonly quantityUnit: string;
}

export const WORKLOAD_METRICS: readonly WorkloadMetricSpec[] = [
  {
    key: 'decodeBatchSize',
    field: 'decode_batch_size',
    label: 'decode batch',
    unit: 'decode requests',
    quantityUnit: '',
  },
  {
    key: 'scheduledKvTokens',
    field: 'scheduled_kv_tokens',
    label: 'scheduled KV',
    unit: 'KV tokens touched',
    quantityUnit: '',
  },
  {
    key: 'prefillTokens',
    field: 'prefill_tokens',
    label: 'prefill tokens',
    unit: 'prompt/chunk tokens',
    quantityUnit: '',
  },
  {
    key: 'iterationCycleMs',
    field: 'iteration_cycle_ms',
    label: 'iteration cycle',
    unit: 'cycle (ms)',
    quantityUnit: 'ms',
  },
];

export type WorkloadAxisMode = 'elapsedTime' | 'iterationId';

export interface WorkloadStats {
  readonly n: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p99: number | null;
  readonly max: number | null;
}

export interface WorkloadPoints {
  readonly x: readonly number[];
  readonly values: readonly number[];
}

export interface WorkloadSideModel {
  readonly stats: WorkloadStats;
  readonly points: WorkloadPoints;
}

export interface WorkloadCardModel {
  readonly key: WorkloadMetricKey;
  readonly field: string;
  readonly label: string;
  readonly unit: string;
  readonly quantityUnit: string;
  readonly measured: WorkloadSideModel | null;
  readonly simulated: WorkloadSideModel | null;
  readonly deltaP50Pct: number | null;
  readonly deltaP90Pct: number | null;
  readonly deltaP99Pct: number | null;
  readonly axisMode: WorkloadAxisMode;
  readonly axisMin: number;
  readonly axisMax: number;
  readonly spanMs: number;
}

/** Iterations whose value the analyzer recorded, with the time they ran at.
 * A cycle is null on the last iteration of a capture, where no next boundary
 * exists to measure against; those iterations leave the series entirely
 * rather than entering it as a zero. */
function observedSamples(
  side: AlignmentWorkloadSide,
  key: WorkloadMetricKey,
  axisMode: WorkloadAxisMode,
): WorkloadPoints {
  const values: number[] = [];
  const x: number[] = [];
  side[key].forEach((value, index) => {
    const coordinate =
      axisMode === 'elapsedTime' ? side.timeMs[index] / 1000 : side.iterationId[index];
    if (value === null || value === undefined || coordinate === undefined) return;
    values.push(value);
    x.push(coordinate);
  });
  return { x, values };
}

function workloadStats(values: readonly number[]): WorkloadStats {
  return {
    n: values.length,
    p50: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    p99: quantile(values, 0.99),
    max: values.length === 0 ? null : maxOf(values),
  };
}

const sideSpanMs = (side: AlignmentWorkloadSide | null): number =>
  side === null || side.timeMs.length === 0 ? 0 : maxOf(side.timeMs);

export function workloadSpanMs(series: AlignmentWorkloadSeries): number {
  return Math.max(sideSpanMs(series.measured), sideSpanMs(series.simulated));
}

export function workloadCards(
  series: AlignmentWorkloadSeries,
  axisMode: WorkloadAxisMode = 'elapsedTime',
): readonly WorkloadCardModel[] {
  const spanMs = workloadSpanMs(series);
  let rawAxisMin = Number.POSITIVE_INFINITY;
  let rawAxisMax = Number.NEGATIVE_INFINITY;
  for (const side of [series.measured, series.simulated]) {
    if (side === null) continue;
    const coordinates = axisMode === 'elapsedTime' ? side.timeMs : side.iterationId;
    for (const rawCoordinate of coordinates) {
      const coordinate = axisMode === 'elapsedTime' ? rawCoordinate / 1000 : rawCoordinate;
      rawAxisMin = Math.min(rawAxisMin, coordinate);
      rawAxisMax = Math.max(rawAxisMax, coordinate);
    }
  }
  if (!Number.isFinite(rawAxisMin) || !Number.isFinite(rawAxisMax)) {
    rawAxisMin = 0;
    rawAxisMax = 1;
  }
  const axisMax = rawAxisMax === rawAxisMin ? rawAxisMin + 1 : rawAxisMax;
  const sideModel = (side: AlignmentWorkloadSide | null, key: WorkloadMetricKey) => {
    if (side === null) return null;
    const points = observedSamples(side, key, axisMode);
    return {
      stats: workloadStats(points.values),
      points,
    };
  };
  return WORKLOAD_METRICS.map((metric) => {
    const measured = sideModel(series.measured, metric.key);
    const simulated = sideModel(series.simulated, metric.key);
    const delta = (percentile: 'p50' | 'p90' | 'p99') => {
      const left = measured?.stats[percentile];
      const right = simulated?.stats[percentile];
      if (left === null || left === undefined || right === null || right === undefined) return null;
      return relativeDeltaPct(left, right);
    };
    return {
      key: metric.key,
      field: metric.field,
      label: metric.label,
      unit: metric.unit,
      quantityUnit: metric.quantityUnit,
      measured,
      simulated,
      deltaP50Pct: delta('p50'),
      deltaP90Pct: delta('p90'),
      deltaP99Pct: delta('p99'),
      axisMode,
      axisMin: rawAxisMin,
      axisMax,
      spanMs,
    };
  });
}

// ---- what each card says about its neighbours -----------------------------

/**
 * A card's footer, as pieces rather than as a string.
 *
 * Every card in this section states a number that only means something next to
 * another card's: a client-clock TTFT is the server-clock one plus the queue in
 * front of it, an end-to-end latency is one TTFT plus a few hundred decode
 * steps. Those relations are the reading, and the analyzer publishes neither
 * of them — it defines each metric alone, correctly and at length, which is a
 * glossary and not a footer.
 *
 * So the footers are composed here, from the numbers the cards already state,
 * and they carry no claim about what a capture shows: every sentence below is
 * a template that holds for any run, with the run's own quantities in it. The
 * analyzer's definition of a metric stays on the card as the title's tooltip,
 * verbatim, which is where a reader goes to ask what was measured rather than
 * how the results sit against each other.
 */
export type NoteSegment =
  | { readonly kind: 'text'; readonly text: string }
  /** A quantity the sentence turns on. */
  | { readonly kind: 'strong'; readonly text: string }
  /** The one quantity per note the reader is meant to leave with. */
  | { readonly kind: 'highlight'; readonly text: string };

const text = (value: string): NoteSegment => ({ kind: 'text', text: value });
const strong = (value: string): NoteSegment => ({ kind: 'strong', text: value });
const highlight = (value: string): NoteSegment => ({ kind: 'highlight', text: value });

/** Every delta in this section is a one-decimal signed percentage, and an
 * absent one is `n/a`: a percentile can be zero on both sides, and a ratio to
 * zero is no reading at all rather than a small error. */
export function deltaText(pct: number | null | undefined): string {
  return pct === null || pct === undefined ? 'n/a' : fmtPctPrecise(pct, 1);
}

const finite = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

export interface LatencyNoteContext {
  /** Output tokens the measured side produced. The end-to-end card is one TTFT
   * plus however many decode steps that implies, so without it that card can
   * still state its delta but not why the delta is the shape it is. */
  readonly measuredOutputTokens: number | null;
}

/**
 * One latency card's footer.
 *
 * Keyed on the analyzer's own comparison key, because what a card can say
 * about its neighbours depends on which neighbour it is — a client-clock view
 * has a server-clock pair, a decode step has an end-to-end row it accumulates
 * into. A key this function does not know returns no footer rather than a
 * generic one, so a comparison added upstream shows its numbers and its
 * definition and waits for a reading to be written for it.
 */
export function latencyNote(
  card: LatencyCardModel,
  cards: readonly LatencyCardModel[],
  context: LatencyNoteContext,
): readonly NoteSegment[] {
  const sibling = (key: string) => cards.find((candidate) => candidate.key === key) ?? null;
  const gapMs = (left: LatencyCardModel | null, right: LatencyCardModel | null): number | null =>
    finite(left?.measured.p50) && finite(right?.measured.p50)
      ? left.measured.p50 - right.measured.p50
      : null;
  const missMs = (subject: LatencyCardModel | null): number | null =>
    finite(subject?.measured.p50) && finite(subject.simulated.p50)
      ? subject.measured.p50 - subject.simulated.p50
      : null;
  const shareOfMeasured = (part: number | null): number | null =>
    part === null || !finite(card.measured.p50) || card.measured.p50 === 0
      ? null
      : (part / card.measured.p50) * 100;

  switch (card.key) {
    case 'client_ttft': {
      const server = sibling('server_ttft');
      const queueMs = gapMs(card, server);
      const share = shareOfMeasured(queueMs);
      const opening = text(
        "Client clock: the engine's prefill plus whatever waits in front of it.",
      );
      if (server === null || queueMs === null || share === null) return [opening];
      return [
        opening,
        text(' The distance to the '),
        strong(server.title),
        text(' card — '),
        highlight(`${fmtFixed(queueMs, 1)} ms`),
        text(
          `, ${fmtFixed(share, 0)} % of this measured p50 — is the part the two measured views `,
        ),
        text('disagree about.'),
      ];
    }
    case 'server_ttft': {
      const miss = missMs(card);
      const opening = text('Server clock: prefill only, the in-engine pair for the card above.');
      if (miss === null) return [opening];
      return [
        opening,
        text(' '),
        strong(deltaText(card.deltaP50Pct)),
        text(` on p50 is ${fmtFixed(miss, 1)} ms.`),
      ];
    }
    case 'tpot':
      return [
        text('One decode step, client clock — '),
        strong(deltaText(card.deltaP50Pct)),
        text(
          ` on ${fmtLatencyMs(card.measured.p50)} ms. This is the per-operation error of one cycle` +
            ' arriving at the request level.',
        ),
      ];
    case 'server_tpot': {
      const viewGapMs = gapMs(sibling('tpot'), card);
      const opening = text('One decode step, server clock.');
      if (viewGapMs === null) {
        return [
          opening,
          text(' The modelled distance on p50 is '),
          strong(deltaText(card.deltaP50Pct)),
          text('.'),
        ];
      }
      return [
        opening,
        text(` The two measured views differ by ${fmtFixed(viewGapMs * 1000, 0)} µs on p50,`),
        text(' against a modelled distance of '),
        strong(deltaText(card.deltaP50Pct)),
        text('.'),
      ];
    }
    case 'e2e': {
      const miss = missMs(sibling('server_ttft'));
      const share = shareOfMeasured(miss);
      const steps =
        context.measuredOutputTokens === null || card.n === 0
          ? null
          : context.measuredOutputTokens / card.n - 1;
      const opening =
        steps === null
          ? text(
              'One TTFT plus every decode step of a request, so this row is TPOT-dominated by construction: the ',
            )
          : text(
              `One TTFT plus ${fmtRounded(steps)} decode steps per request, so this row is` +
                ' TPOT-dominated by construction: the ',
            );
      const head = [opening, strong(deltaText(card.deltaP50Pct))];
      if (miss === null || share === null) return [...head, text(' here is that sum.')];
      return [
        ...head,
        text(` here carries a TTFT distance of ${fmtFixed(miss, 1)} ms, which is `),
        highlight(`${fmtFixed(share, 2)} %`),
        text(' of the measured p50.'),
      ];
    }
    default:
      return [];
  }
}

export interface ScheduleContext {
  readonly measuredIterations: number | null;
  readonly simulatedIterations: number | null;
  readonly measuredCycleMs: number | null;
  readonly simulatedCycleMs: number | null;
}

/** The schedule behind a rate: how many iterations each side ran, and how long
 * one of them took. The rate card quotes these because the same tokens per
 * second can be reached by a different schedule, which is the whole reason the
 * scheduler panel exists below it. */
export function scheduleContext(
  series: AlignmentWorkloadSeries | null,
  cards: readonly WorkloadCardModel[],
): ScheduleContext {
  const cycle = cards.find((candidate) => candidate.key === 'iterationCycleMs') ?? null;
  return {
    measuredIterations: series?.measured?.iterationId.length ?? null,
    simulatedIterations: series?.simulated?.iterationId.length ?? null,
    measuredCycleMs: cycle?.measured?.stats.p50 ?? null,
    simulatedCycleMs: cycle?.simulated?.stats.p50 ?? null,
  };
}

/** The rate card's footer: the difference, the schedule that produced it, and
 * the reminder that those are two separate claims. */
export function throughputNote(
  card: ThroughputCardModel,
  schedule: ScheduleContext,
): readonly NoteSegment[] {
  const head: NoteSegment[] = [
    strong(deltaText(card.deltaPct)),
    text(
      card.measured.outputTokens !== null &&
        card.measured.outputTokens === card.simulated.outputTokens
        ? ' on the same output tokens'
        : ' with output-token totals unavailable or different',
    ),
  ];
  const tail: NoteSegment[] = [
    text(' '),
    highlight('The rate and the schedule that produced it are two separate claims'),
    text('; the panel below is the second one.'),
  ];
  const complete =
    finite(schedule.measuredIterations) &&
    finite(schedule.simulatedIterations) &&
    finite(schedule.measuredCycleMs) &&
    finite(schedule.simulatedCycleMs);
  if (!complete) return [...head, text('.'), ...tail];
  return [
    ...head,
    text(
      ` — reached with ${fmtRounded(schedule.simulatedIterations)} modelled iterations against` +
        ` ${fmtRounded(schedule.measuredIterations)} measured, each one` +
        ` ${fmtFixed(schedule.simulatedCycleMs, 3)} ms instead of` +
        ` ${fmtFixed(schedule.measuredCycleMs, 3)}.`,
    ),
    ...tail,
  ];
}

/** A scheduler-shape card's footer: the same distribution read at two more
 * points, because a p50 that matches says nothing about the tail. */
export function workloadNote(card: WorkloadCardModel): readonly NoteSegment[] {
  return [
    text('p90 '),
    strong(deltaText(card.deltaP90Pct)),
    text(' · p99 '),
    strong(deltaText(card.deltaP99Pct)),
    text(' — the same schedule read at two more points of its own distribution.'),
  ];
}

// ---- the same schedule as one number per side -----------------------------

export interface WorkloadSummaryRow {
  readonly label: string;
  readonly measured: number | null;
  readonly simulated: number | null;
  /** The unit the two values carry, for formatting through `fmtQuantity`. */
  readonly quantityUnit: string;
  readonly measuredFraction: number;
  readonly simulatedFraction: number;
}

function summaryRow(
  label: string,
  measured: number | null,
  simulated: number | null,
  quantityUnit: string,
): WorkloadSummaryRow {
  const highest = Math.max(measured ?? 0, simulated ?? 0);
  const fraction = (value: number | null) =>
    value === null || highest <= 0 ? 0 : (value / highest) * 100;
  return {
    label,
    measured,
    simulated,
    quantityUnit,
    measuredFraction: fraction(measured),
    simulatedFraction: fraction(simulated),
  };
}

/** The percentiles the four figures are read at, one row per number. The rows
 * quote the same statistics the cards above draw, so the table cannot state a
 * schedule the figures do not show. */
export function workloadSummaryRows(
  series: AlignmentWorkloadSeries,
  cards: readonly WorkloadCardModel[],
): readonly WorkloadSummaryRow[] {
  const statOf = (key: WorkloadMetricKey, percentile: 'p50' | 'p90') => {
    const card = cards.find((candidate) => candidate.key === key);
    return {
      measured: card?.measured?.stats[percentile] ?? null,
      simulated: card?.simulated?.stats[percentile] ?? null,
    };
  };
  const decodeBatch = statOf('decodeBatchSize', 'p50');
  const scheduledKv = statOf('scheduledKvTokens', 'p50');
  const prefill = statOf('prefillTokens', 'p90');
  const cycle = statOf('iterationCycleMs', 'p50');
  return [
    summaryRow(
      'iterations',
      series.measured?.iterationId.length ?? null,
      series.simulated?.iterationId.length ?? null,
      '',
    ),
    summaryRow('decode batch p50', decodeBatch.measured, decodeBatch.simulated, ''),
    summaryRow('scheduled KV p50', scheduledKv.measured, scheduledKv.simulated, ''),
    summaryRow('prefill tok p90', prefill.measured, prefill.simulated, ''),
    summaryRow('cycle p50 ms', cycle.measured, cycle.simulated, 'ms'),
    summaryRow('span ms', sideSpanMs(series.measured), sideSpanMs(series.simulated), 'ms'),
  ];
}
