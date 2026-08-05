import { CHART_THEME } from '../../charts/platform';
import type { AlignmentIterationSeries, AlignmentPairedIteration } from '../../domain/alignment';
import { GROUP } from '../../domain/cost-tree';
import { tokens } from '../../theme';
import {
  clampViewport,
  fullViewport,
  isFullViewport,
  plotInsets,
  spanOf,
  type AxisSpan,
} from './axisZoom';
import { fmtInt } from './format';

/**
 * §01 — every iteration, paired: the arithmetic.
 *
 * Everything numeric on the card lives here as a pure function, so the card
 * itself only positions DOM and the canvas only strokes what this file has
 * already placed. Three stacked panels share one iteration axis: the two
 * lanes' times, the signed relative error, and whether that error accumulates.
 *
 * The capture carries thousands of iterations against roughly a thousand plot
 * columns, so a per-point polyline would be a picket fence that hides both the
 * level and the spread. Each column keeps the min, max and mean of the
 * iterations that land in it; the extent draws as a band and the mean as the
 * line. Below one iteration per column that reduction is skipped and every
 * point is drawn.
 */

// ---- palette --------------------------------------------------------------

/** The one measured/modelled pair, plus the two derived series.
 *
 * Measured is the shared dense-GEMM blue rather than an alignment-only hue:
 * the measured lane is the same quantity §03 draws in family colour, and a
 * private palette here would make the two cards incomparable. */
export const PAIRED_SERIES_COLOR = {
  measured: GROUP.gemm.color,
  modelled: tokens.terra,
  relative: tokens.sub,
  cumulative: tokens.olive,
} as const;

export const PLOT_AXIS_COLOR = CHART_THEME.axis;
export const PLOT_GRID_COLOR = tokens.hair;
export const PLOT_LABEL_COLOR = tokens.sub2;
export const PLOT_AXIS_NAME_COLOR = tokens.sub;

// ---- the two families -----------------------------------------------------

/** Which of the two time bases the panels read. Kernel time is what the model
 * predicts; GPU cycle is that time scaled by the duty multiplier, next to the
 * measured boundary-to-boundary wall clock. They answer different questions
 * and must never be mixed inside one panel. */
export type PairedFamilyKey = 'kernel' | 'gpu_cycle';

export interface PairedFamily {
  readonly key: PairedFamilyKey;
  /** The chip, and the heading of the rail group that summarises the lanes. */
  readonly label: string;
  readonly measuredLabel: string;
  readonly simulatedLabel: string;
  /** The value panel's axis name. */
  readonly unit: string;
  /** The analyzer's own sentence for the relative difference, verbatim. */
  readonly definition: string | undefined;
  /** The analyzer's own sentence for the measured side, verbatim. */
  readonly measuredDefinition: string | undefined;
  readonly measured: readonly (number | null)[];
  readonly simulated: readonly (number | null)[];
  readonly relative: readonly (number | null)[];
  readonly cumulative: readonly (number | null)[];
}

export interface PairedSeries {
  readonly iterationId: readonly number[];
  /** Index into `typeNames` per iteration, so the strip walks numbers. */
  readonly iterationType: readonly number[];
  readonly typeNames: readonly string[];
  readonly families: readonly PairedFamily[];
}

/** Iteration types in a stable order. Sorted rather than first-seen so the
 * legend, the strip and the rail agree no matter which iteration the capture
 * happens to start on. */
function iterationTypeNames(iterations: readonly AlignmentPairedIteration[]): readonly string[] {
  return [...new Set(iterations.map((iteration) => iteration.iterationType))].sort((left, right) =>
    left.localeCompare(right, 'en'),
  );
}

export function pairedSeries(series: AlignmentIterationSeries): PairedSeries {
  const { iterations, definitions } = series;
  const typeNames = iterationTypeNames(iterations);
  return {
    iterationId: iterations.map((iteration) => iteration.iterationId),
    iterationType: iterations.map((iteration) => typeNames.indexOf(iteration.iterationType)),
    typeNames,
    families: [
      {
        key: 'kernel',
        label: 'Kernel critical path',
        measuredLabel: 'Measured replica critical path',
        simulatedLabel: 'Timing-predict',
        unit: 'kernel time (ms)',
        definition: definitions.relative_diff_pct,
        measuredDefinition: definitions.measured_ms,
        measured: iterations.map((iteration) => iteration.measuredMs),
        simulated: iterations.map((iteration) => iteration.simulatedMs),
        relative: iterations.map((iteration) => iteration.relativeDiffPct),
        cumulative: iterations.map((iteration) => iteration.cumulativeRelativeDiffPct),
      },
      {
        key: 'gpu_cycle',
        label: 'GPU cycle',
        measuredLabel: 'Measured GPU cycle',
        simulatedLabel: 'Timing-predict',
        unit: 'GPU iteration cycle (ms)',
        definition: definitions.gpu_cycle_relative_diff_pct,
        measuredDefinition: definitions.measured_gpu_cycle_ms,
        measured: iterations.map((iteration) => iteration.measuredGpuCycleMs),
        simulated: iterations.map((iteration) => iteration.simulatedGpuCycleMs),
        relative: iterations.map((iteration) => iteration.gpuCycleRelativeDiffPct),
        cumulative: iterations.map((iteration) => iteration.gpuCycleCumulativeRelativeDiffPct),
      },
    ],
  };
}

// ---- distribution ---------------------------------------------------------

const finiteValues = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null && Number.isFinite(value));

export function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export interface SeriesStats {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly absoluteP90: number;
  readonly min: number;
  readonly max: number;
  readonly last: number;
  /** The 1st and 99th percentile, the window a clipped panel keeps. */
  readonly robust: readonly [number, number];
}

export function seriesStats(values: readonly (number | null)[]): SeriesStats {
  const clean = finiteValues(values);
  const sorted = [...clean].sort((left, right) => left - right);
  const absolute = clean.map(Math.abs).sort((left, right) => left - right);
  return {
    n: clean.length,
    mean: clean.reduce((total, value) => total + value, 0) / (clean.length || 1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    absoluteP90: quantile(absolute, 0.9),
    min: sorted[0] ?? Number.NaN,
    max: sorted[sorted.length - 1] ?? Number.NaN,
    last: clean[clean.length - 1] ?? Number.NaN,
    robust: [quantile(sorted, 0.01), quantile(sorted, 0.99)],
  };
}

// ---- axis ticks -----------------------------------------------------------

export function niceTicks(low: number, high: number, count: number): readonly number[] {
  const span = high - low;
  if (!(span > 0)) return [low];
  const raw = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(value);
  }
  return ticks;
}

const fixedFormatters = new Map<number, Intl.NumberFormat>();

/**
 * A bare scale number for a tick or a range bound.
 *
 * The unit belongs to the axis name, not to every tick, which is the same
 * split the app's ECharts axes already use — their labels are bare numbers
 * too. `fmtMs` is for a quantity a reader takes away; this is for the ruler it
 * is read against, and it keeps more digits as the scale gets finer so a
 * 0.001-wide panel does not print four identical zeros.
 */
export function axisTickLabel(value: number): string {
  // A tick step that starts just below zero lands on negative zero, which
  // formats with a minus sign and reads as a distinct value on the axis.
  const normalized = value === 0 ? 0 : value;
  const magnitude = Math.abs(normalized);
  const digits = magnitude >= 1000 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 3;
  let formatter = fixedFormatters.get(digits);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false,
    });
    fixedFormatters.set(digits, formatter);
  }
  return formatter.format(normalized);
}

// ---- plot geometry --------------------------------------------------------

export type PanelKey = 'value' | 'relative' | 'cumulative';

/** The plot is laid out in one fixed coordinate space and scaled to whatever
 * width the card gets, so every type size and gap keeps its designed ratio
 * instead of drifting with the viewport. */
export const PLOT = {
  width: 1180,
  left: 80,
  right: 16,
  top: 32,
  gap: 38,
  /** Height of the iteration-type strip above the first panel. */
  strip: 24,
  /** Room under the shared x axis for its tick labels and name. */
  axis: 36,
  /** A clear row under the strip for the hover pill, so naming an iteration
   * never lands on top of the first panel's axis name. */
  hoverRow: 54,
  panels: [
    { key: 'value', height: 256 },
    { key: 'relative', height: 162 },
    { key: 'cumulative', height: 162 },
  ],
} as const satisfies { readonly panels: readonly { key: PanelKey; height: number }[] } & Record<
  string,
  unknown
>;

/** Where the plot sits inside the drawn surface, for the pointer gestures that
 * zoom it. Fractions of the fixed coordinate space, which is exactly what
 * survives the scaling to whatever width the card is given. */
export const PLOT_INSETS = plotInsets(PLOT.left, PLOT.right, PLOT.width);

export interface PairedLayout {
  readonly count: number;
  readonly plotWidth: number;
  readonly columnCount: number;
  /** The window of iteration ordinals the x axis currently spans. Full by
   * default; a zoom gesture narrows it and every placement below follows. */
  readonly viewport: AxisSpan;
  /** How many iterations that window holds. The reduction below is chosen by
   * this rather than by the capture's size: zooming into a hundred iterations
   * of a long run should draw them as points, not as a band of one-per-pixel
   * columns it no longer needs. */
  readonly visibleCount: number;
  /** True when visible iterations outnumber columns, which selects the band. */
  readonly dense: boolean;
  /** True when few enough are visible to mark every point. */
  readonly markers: boolean;
  readonly tops: readonly number[];
  /** The y of the shared x axis. */
  readonly axisY: number;
  readonly height: number;
  readonly ranges: Readonly<Record<PanelKey, readonly [number, number]>>;
  readonly valueStats: SeriesStats;
  readonly relativeStats: SeriesStats;
  readonly cumulativeStats: SeriesStats;
}

/** Pad a range so the extreme point is not welded to the panel edge. */
function padded(low: number, high: number): readonly [number, number] {
  const margin = (high - low || 1) * 0.08;
  return [low - margin, high + margin];
}

/** The x axis's full domain: iteration ordinals, not iteration ids, because the
 * ids a capture emits need not be contiguous. */
export const iterationDomain = (count: number): AxisSpan => ({
  start: 0,
  end: Math.max(0, count - 1),
});

export function pairedLayout(family: PairedFamily, viewport?: AxisSpan): PairedLayout {
  const count = family.measured.length;
  const domain = iterationDomain(count);
  const window = viewport === undefined ? fullViewport(domain) : clampViewport(viewport, domain);
  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const columnCount = Math.max(1, Math.round(plotWidth));
  const visibleCount = countWithin(window, count);

  const tops: number[] = [];
  let cursor = PLOT.top + PLOT.strip + PLOT.hoverRow;
  for (const panel of PLOT.panels) {
    tops.push(cursor);
    cursor += panel.height + PLOT.gap;
  }

  const valueStats = seriesStats([...family.measured, ...family.simulated]);
  const relativeStats = seriesStats(family.relative);
  const cumulativeStats = seriesStats(family.cumulative);

  return {
    count,
    plotWidth,
    columnCount,
    viewport: window,
    visibleCount,
    dense: visibleCount > columnCount,
    markers: visibleCount <= 400,
    tops,
    axisY: tops[tops.length - 1] + PLOT.panels[PLOT.panels.length - 1].height,
    height: cursor - PLOT.gap + PLOT.axis,
    ranges: {
      // The value panel keeps its full range from zero. The relative panel is
      // clipped to a robust window, because one transition iteration can be an
      // order of magnitude off and would flatten the band every other
      // iteration lives in; clipped points are drawn on the edge and counted.
      value: padded(0, valueStats.max),
      relative: padded(relativeStats.robust[0], relativeStats.robust[1]),
      cumulative: padded(cumulativeStats.min, cumulativeStats.max),
    },
    valueStats,
    relativeStats,
    cumulativeStats,
  };
}

/** The first and last iteration ordinal inside a window, both drawable. */
export function visibleIterationRange(layout: PairedLayout): readonly [number, number] {
  const last = Math.max(0, layout.count - 1);
  const first = Math.max(0, Math.min(last, Math.ceil(layout.viewport.start)));
  return [first, Math.max(first, Math.min(last, Math.floor(layout.viewport.end)))];
}

function countWithin(window: AxisSpan, count: number): number {
  if (count <= 0) return 0;
  const first = Math.max(0, Math.ceil(window.start));
  const last = Math.min(count - 1, Math.floor(window.end));
  return Math.max(1, last - first + 1);
}

/**
 * The ordinals a drawing pass has to walk.
 *
 * One iteration wider than the window on each side, so a line zoomed into the
 * middle of a capture enters and leaves the plot at its edges instead of
 * starting at the first visible point.
 */
export function visibleIndexWindow(layout: PairedLayout): readonly [number, number] {
  return [
    Math.max(0, Math.floor(layout.viewport.start) - 1),
    Math.min(Math.max(0, layout.count - 1), Math.ceil(layout.viewport.end) + 1),
  ];
}

export const iterationToX = (layout: PairedLayout, index: number): number => {
  const span = spanOf(layout.viewport);
  return (
    PLOT.left +
    (span > 0 ? ((index - layout.viewport.start) / span) * layout.plotWidth : layout.plotWidth / 2)
  );
};

/** Which plot column an ordinal falls in, or null when the window excludes it.
 * The last drawable ordinal lands one past the final column, so it is pulled
 * back rather than dropped. */
function plotColumnOf(layout: PairedLayout, index: number): number | null {
  const column = Math.round(iterationToX(layout, index) - PLOT.left);
  if (column < 0 || column > layout.columnCount) return null;
  return Math.min(layout.columnCount - 1, column);
}

export function panelScale(
  layout: PairedLayout,
  panelIndex: number,
  key: PanelKey,
): (value: number) => number {
  const [low, high] = layout.ranges[key];
  const top = layout.tops[panelIndex];
  const height = PLOT.panels[panelIndex].height;
  return (value) => top + height - ((value - low) / (high - low)) * height;
}

// ---- per-column reduction -------------------------------------------------

export interface ColumnCell {
  min: number;
  max: number;
  sum: number;
  n: number;
}

/** Reduce a series to one cell per plot column. */
export function pixelColumns(
  values: readonly (number | null)[],
  layout: PairedLayout,
): readonly (ColumnCell | null)[] {
  const cells: (ColumnCell | null)[] = new Array(layout.columnCount).fill(null);
  const [from, to] = visibleIndexWindow(layout);
  for (let index = from; index <= Math.min(to, values.length - 1); index += 1) {
    const value = values[index];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const column = plotColumnOf(layout, index);
    if (column === null) continue;
    const existing = cells[column];
    if (existing === null) {
      cells[column] = { min: value, max: value, sum: value, n: 1 };
      continue;
    }
    if (value < existing.min) existing.min = value;
    if (value > existing.max) existing.max = value;
    existing.sum += value;
    existing.n += 1;
  }
  return cells;
}

export type PlotPoint = readonly [number, number];

export interface BandAndMean {
  /** Closed outline: the column maxima left to right, then the minima back. */
  readonly band: readonly PlotPoint[];
  readonly mean: readonly PlotPoint[];
  /** How many placements the clip window pulled onto a panel edge. */
  readonly clamped: number;
}

export function bandAndMean(
  cells: readonly (ColumnCell | null)[],
  toY: (value: number) => number,
  clampTo: readonly [number, number] | null,
): BandAndMean {
  const top: PlotPoint[] = [];
  const bottom: PlotPoint[] = [];
  const mean: PlotPoint[] = [];
  let clamped = 0;
  const fit = (value: number): number => {
    if (clampTo === null) return value;
    if (value < clampTo[0]) {
      clamped += 1;
      return clampTo[0];
    }
    if (value > clampTo[1]) {
      clamped += 1;
      return clampTo[1];
    }
    return value;
  };
  cells.forEach((cell, column) => {
    if (cell === null) return;
    const x = PLOT.left + column;
    top.push([x, toY(fit(cell.max))]);
    bottom.unshift([x, toY(fit(cell.min))]);
    mean.push([x, toY(fit(cell.sum / cell.n))]);
  });
  return { band: [...top, ...bottom], mean, clamped };
}

export interface PolylineSegment {
  readonly points: readonly PlotPoint[];
  /** The subset of `points` the clip window moved onto a panel edge. */
  readonly clampedPoints: readonly PlotPoint[];
}

export interface Polylines {
  readonly segments: readonly PolylineSegment[];
  readonly clamped: number;
}

/** Split a series into runs of present values, so an absent iteration breaks
 * the line instead of drawing a chord across it. */
export function polylines(
  values: readonly (number | null)[],
  layout: PairedLayout,
  toY: (value: number) => number,
  clampTo: readonly [number, number] | null,
): Polylines {
  const segments: PolylineSegment[] = [];
  let points: PlotPoint[] = [];
  let clampedPoints: PlotPoint[] = [];
  let clamped = 0;
  const flush = () => {
    if (points.length > 0) segments.push({ points, clampedPoints });
    points = [];
    clampedPoints = [];
  };
  const [from, to] = visibleIndexWindow(layout);
  for (let index = from; index <= Math.min(to, values.length - 1); index += 1) {
    const value = values[index];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      flush();
      continue;
    }
    let plotted = value;
    if (clampTo !== null) {
      if (value < clampTo[0]) {
        plotted = clampTo[0];
        clamped += 1;
      } else if (value > clampTo[1]) {
        plotted = clampTo[1];
        clamped += 1;
      }
    }
    const point: PlotPoint = [iterationToX(layout, index), toY(plotted)];
    points.push(point);
    if (plotted !== value) clampedPoints.push(point);
  }
  flush();
  return { segments, clamped };
}

// ---- the iteration-type strip ---------------------------------------------

export interface StripRun {
  readonly typeIndex: number;
  readonly column: number;
  readonly width: number;
}

/**
 * Iteration types interleave faster than one per column in a long run, so a
 * column is not one type — it is a mixture. Every column takes the colour of
 * the RAREST type that lands in it: a partial-height bar for a minority type
 * reads as noise at this scale, and a single rare iteration has to survive the
 * column it shares. Rarity is global, not per column, because that stays true
 * wherever the column falls. Runs of one colour are merged.
 */
export function iterationTypeStrip(
  iterationType: readonly number[],
  layout: PairedLayout,
): readonly StripRun[] {
  const totals = iterationTypeTotals(iterationType);
  const columnType: (number | null)[] = new Array(layout.columnCount).fill(null);
  const [from, to] = visibleIndexWindow(layout);
  for (let index = from; index <= Math.min(to, iterationType.length - 1); index += 1) {
    const typeIndex = iterationType[index];
    const column = plotColumnOf(layout, index);
    if (column === null) continue;
    const current = columnType[column];
    if (current === null || (totals[typeIndex] ?? 0) < (totals[current] ?? 0)) {
      columnType[column] = typeIndex;
    }
  }
  const runs: StripRun[] = [];
  for (let column = 0; column < layout.columnCount;) {
    const typeIndex = columnType[column];
    if (typeIndex === null) {
      column += 1;
      continue;
    }
    let end = column + 1;
    while (end < layout.columnCount && columnType[end] === typeIndex) end += 1;
    // The extra sliver closes the seam antialiasing would otherwise open
    // between two adjacent runs of the same colour.
    runs.push({ typeIndex, column, width: end - column + 0.05 });
    column = end;
  }
  return runs;
}

export function iterationTypeTotals(
  iterationType: readonly number[],
): Readonly<Record<number, number>> {
  const totals: Record<number, number> = {};
  for (const typeIndex of iterationType) totals[typeIndex] = (totals[typeIndex] ?? 0) + 1;
  return totals;
}

/** Counts, not percentages: a single rare iteration in a long run rounds to
 * 0.0 % and reads as absent. */
export function iterationTypeShare(
  iterationType: readonly number[],
  typeNames: readonly string[],
): string {
  const totals = iterationTypeTotals(iterationType);
  return Object.entries(totals)
    .sort((left, right) => right[1] - left[1])
    .map(([typeIndex, hits]) => `${typeNames[Number(typeIndex)]} ${fmtInt(hits)}`)
    .join('  ·  ');
}

export function densityNote(layout: PairedLayout): string {
  // The column count is a coordinate, not a counted quantity, so it stays a
  // plain integer while the iteration count goes through the shared formatter.
  return layout.dense
    ? `${fmtInt(layout.visibleCount)} iterations over ${layout.columnCount} px — band is each pixel's min…max, line is its mean`
    : `${fmtInt(layout.visibleCount)} iterations, every point drawn`;
}

/**
 * What the iteration axis currently spans, in the ids it prints.
 *
 * The ids are written as the analyzer emitted them rather than grouped: they
 * name a record, and the axis ticks beside this sentence print them the same
 * way. The counts are quantities, so those go through the shared formatter.
 */
export function viewportNote(series: PairedSeries, layout: PairedLayout): string {
  if (layout.count === 0) return 'x axis · no iterations';
  if (isFullViewport(layout.viewport, iterationDomain(layout.count))) {
    return `x axis · every one of ${fmtInt(layout.count)} iterations`;
  }
  const [first, last] = visibleIterationRange(layout);
  return `x axis · iterations ${series.iterationId[first]} … ${series.iterationId[last]} · ${fmtInt(
    layout.visibleCount,
  )} of ${fmtInt(layout.count)}`;
}

/** The iteration a pointer at `clientRatio` of the plot's full width names. */
export function hoverIndexAt(layout: PairedLayout, clientRatio: number): number {
  const x = clientRatio * PLOT.width;
  const ratio = (x - PLOT.left) / (PLOT.width - PLOT.left - PLOT.right);
  const index = layout.viewport.start + ratio * spanOf(layout.viewport);
  return Math.max(0, Math.min(layout.count - 1, Math.round(index)));
}
