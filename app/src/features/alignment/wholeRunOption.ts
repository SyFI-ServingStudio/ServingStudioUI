import { chartFont } from '../../theme/metrics';
import type {
  EChartsOption,
  LineSeriesOption,
  ScatterSeriesOption,
  XAXisComponentOption,
  YAXisComponentOption,
} from 'echarts';

import { CHART_THEME, richTextTooltip, tooltipLines } from '../../charts/platform';
import type { AlignmentCdfComparison, AlignmentThroughputSeries } from '../../domain/alignment';
import { GROUP } from '../../domain/cost-tree';
import { tokens } from '../../theme';
import { fmtFigureTick, fmtPct, fmtQuantity } from './format';
import { niceStep, niceTicks, type WorkloadCardModel } from './wholeRunModel';

/**
 * §05's three figures.
 *
 * Each card states a result as three numbers and then draws the evidence
 * underneath it at full resolution: the empirical distribution of every
 * request, the binned rate across the run, or the folded envelope of every
 * scheduler iteration. Nothing here summarises further than the figure it
 * draws — percentile markers sit ON the curve so that reading the number and
 * reading the picture cannot disagree.
 *
 * The two lanes keep one pair of colours across all three figures, so
 * measured and modelled are recognised by hue alone on every card.
 */

const MEASURED_COLOR = GROUP.gemm.color;
const MODELLED_COLOR = tokens.terra;

export const LANE_COLORS = { measured: MEASURED_COLOR, modelled: MODELLED_COLOR } as const;

const TICK_FONT_SIZE = 9;
const CAPTION_FONT_SIZE = 9;
const CURVE_WIDTH = 1.5;

const maxValue = (values: readonly number[], initial = 0): number =>
  values.reduce((highest, value) => Math.max(highest, value), initial);

const tickLabel = (value: number): string => fmtFigureTick(value);

/** The plot frame every figure shares: hairline ticks along the bottom, a
 * caption at the far end of the value axis, and no vertical rules. */
function figureXAxis(options: {
  readonly min: number;
  readonly max: number;
  readonly caption: string;
}): XAXisComponentOption {
  const ticks = niceTicks(options.min, options.max, 4).filter(
    (tick) => tick >= options.min && tick <= options.max,
  );
  return {
    type: 'value',
    min: options.min,
    max: options.max,
    name: options.caption,
    nameLocation: 'end',
    nameGap: 6,
    nameTextStyle: {
      color: CHART_THEME.sub,
      fontSize: CAPTION_FONT_SIZE,
      fontFamily: tokens.mono,
      align: 'right',
      verticalAlign: 'top',
      padding: [16, 0, 0, 0],
    },
    axisLine: { show: true, lineStyle: { color: tokens.hair } },
    axisTick: {
      show: true,
      length: 3,
      lineStyle: { color: tokens.hair },
      customValues: [...ticks],
    },
    axisLabel: {
      color: CHART_THEME.sub,
      fontSize: TICK_FONT_SIZE,
      fontFamily: tokens.mono,
      customValues: [...ticks],
      formatter: tickLabel,
      margin: 6,
    },
    splitLine: { show: false },
  };
}

/** A value axis anchored at zero, whose split lines fall on the same round
 * positions the tick labels do. */
function zeroBasedYAxis(max: number, caption: string): YAXisComponentOption {
  // The axis tops out a little above the tallest observation so the curve
  // clears the frame; that headroom is not itself a reading, so it carries a
  // rule but no label.
  const ticks = niceTicks(0, max, 4).filter((tick) => tick <= max);
  return {
    type: 'value',
    min: 0,
    max,
    interval: niceStep(0, max, 4),
    name: caption,
    nameLocation: 'end',
    nameGap: 8,
    nameTextStyle: {
      color: CHART_THEME.sub,
      fontSize: CAPTION_FONT_SIZE,
      fontFamily: tokens.mono,
      align: 'left',
    },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: CHART_THEME.sub,
      fontSize: TICK_FONT_SIZE,
      fontFamily: tokens.mono,
      customValues: [...ticks],
      formatter: tickLabel,
      margin: 5,
    },
    splitLine: { lineStyle: { color: tokens.hair } },
  };
}

interface RuleSpec {
  readonly yAxis?: number;
  readonly xAxis?: number;
  readonly dashed: boolean;
  readonly color: string;
}

/** Rules are drawn by a silent, dataless series so that the figure's own
 * curves keep their tooltip behaviour. */
function ruleSeries(rules: readonly RuleSpec[]): LineSeriesOption {
  return {
    type: 'line',
    data: [],
    silent: true,
    animation: false,
    markLine: {
      silent: true,
      symbol: ['none', 'none'],
      label: { show: false },
      emphasis: { disabled: true },
      data: rules.map((rule) => ({
        ...(rule.yAxis === undefined ? {} : { yAxis: rule.yAxis }),
        ...(rule.xAxis === undefined ? {} : { xAxis: rule.xAxis }),
        lineStyle: {
          color: rule.color,
          width: 1,
          type: rule.dashed ? ([2, 3] as [number, number]) : 'solid',
          opacity: 1,
        },
      })),
    },
  };
}

// ---- the empirical distribution of every request --------------------------

const MARKER_PERCENTILES: readonly (readonly [string, number])[] = [
  ['p50', 50],
  ['p90', 90],
  ['p99', 99],
];

/**
 * The empirical CDF of a sample: flat at zero up to the smallest observation,
 * a step of 1/n at every observation, flat at 100 beyond the largest. Nothing
 * is binned or smoothed, and the percentile markers are placed on the curve
 * from the analyzer's own marker set rather than re-read off the drawing.
 */
export function latencyCdfOption(
  comparison: AlignmentCdfComparison,
  guideValue: number | null,
): EChartsOption | null {
  const sides = [comparison.measured, comparison.simulated];
  if (sides.every((side) => side.x.length === 0)) return null;
  const lows = sides.flatMap((side) => (side.x.length === 0 ? [] : [side.x[0]]));
  const highs = sides.flatMap((side) => (side.x.length === 0 ? [] : [side.x[side.x.length - 1]]));
  const low = Math.min(...lows);
  const high = Math.max(...highs);
  const padding = (high - low) * 0.035 || 1;
  const xMin = low - padding;
  const xMax = high + padding;

  const curve = (
    side: AlignmentCdfComparison['measured'],
    color: string,
  ): [LineSeriesOption, ScatterSeriesOption] => [
    {
      name: side.label,
      type: 'line',
      step: 'end',
      showSymbol: false,
      animation: false,
      sampling: 'lttb',
      lineStyle: { width: CURVE_WIDTH, color, join: 'round' },
      itemStyle: { color },
      data: [[xMin, 0], ...side.x.map((value, index) => [value, side.yPct[index]]), [xMax, 100]],
    },
    {
      name: `${side.label} markers`,
      type: 'scatter',
      silent: true,
      animation: false,
      symbolSize: 4.8,
      itemStyle: { color },
      data: MARKER_PERCENTILES.flatMap(([marker, percentile]) => {
        const at = side.markers[marker];
        return at === undefined ? [] : [[at, percentile]];
      }),
    },
  ];

  return {
    animation: false,
    legend: { show: false },
    grid: { left: 34, right: 14, top: 20, bottom: 30 },
    tooltip: richTextTooltip(CHART_THEME, 'axis', {
      axisPointer: { type: 'line' },
      formatter: (parameters: unknown) => {
        const rows = (Array.isArray(parameters) ? parameters : [parameters]) as {
          seriesName?: string;
          seriesType?: string;
          data?: [number, number];
        }[];
        return tooltipLines(
          rows
            .filter((row) => row.seriesType === 'line')
            .map(
              (row) =>
                `${row.seriesName ?? ''} ${fmtQuantity(row.data?.[0] ?? 0, comparison.unit)} · ${fmtPct(row.data?.[1] ?? 0)}`,
            ),
        );
      },
    }),
    xAxis: figureXAxis({ min: xMin, max: xMax, caption: comparison.unit }),
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      name: '100 % of requests',
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: {
        color: CHART_THEME.sub,
        fontSize: CAPTION_FONT_SIZE,
        fontFamily: tokens.mono,
        align: 'left',
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_THEME.sub,
        fontSize: TICK_FONT_SIZE,
        fontFamily: tokens.mono,
        customValues: [0, 50, 90],
        formatter: tickLabel,
        margin: 5,
      },
      splitLine: { show: false },
    },
    series: [
      ruleSeries([
        { yAxis: 0, dashed: false, color: tokens.hair },
        { yAxis: 50, dashed: true, color: tokens.hair },
        { yAxis: 90, dashed: true, color: tokens.hair },
        { yAxis: 100, dashed: false, color: tokens.hair },
        ...(guideValue === null ? [] : [{ xAxis: guideValue, dashed: true, color: tokens.sub2 }]),
      ]),
      ...curve(comparison.measured, MEASURED_COLOR),
      ...curve(comparison.simulated, MODELLED_COLOR),
    ],
  };
}

// ---- the rate across the run ----------------------------------------------

/**
 * Throughput has no per-request sample, so its evidence is the run itself:
 * the token rate of every completion bin, with each side's whole-run rate
 * drawn through as a dashed rule.
 */
export function throughputRateOption(
  bins: AlignmentThroughputSeries,
  means: { readonly measured: number | null; readonly simulated: number | null },
): EChartsOption | null {
  if (bins.tStartMs.length === 0) return null;
  const spanMs = bins.tEndMs[bins.tEndMs.length - 1];
  if (spanMs === undefined) return null;
  let highest = maxValue(bins.measuredOutputTps);
  highest = maxValue(bins.simulatedOutputTps, highest);
  if (means.measured !== null) highest = Math.max(highest, means.measured);
  if (means.simulated !== null) highest = Math.max(highest, means.simulated);
  const peak = highest * 1.08 || 1;

  // One horizontal segment per bin, joined at the bin boundary: the rate is a
  // property of the whole bin, not of a point inside it.
  const staircase = (values: readonly number[]) =>
    values.flatMap((value, index) => [
      [bins.tStartMs[index], value],
      [bins.tEndMs[index], value],
    ]);

  const lane = (name: string, color: string, values: readonly number[], mean: number | null) => [
    {
      name,
      type: 'line' as const,
      showSymbol: false,
      animation: false,
      lineStyle: { width: CURVE_WIDTH, color, join: 'round' as const },
      itemStyle: { color },
      data: staircase(values),
    },
    ...(mean === null ? [] : [ruleSeries([{ yAxis: mean, dashed: true, color }])]),
  ];

  return {
    animation: false,
    legend: { show: false },
    grid: { left: 44, right: 14, top: 20, bottom: 30 },
    tooltip: richTextTooltip(CHART_THEME, 'axis', {
      formatter: (parameters: unknown) => {
        const rows = (Array.isArray(parameters) ? parameters : [parameters]) as {
          seriesName?: string;
          data?: [number, number];
        }[];
        return tooltipLines(
          rows.map((row) => `${row.seriesName ?? ''} ${fmtQuantity(row.data?.[1] ?? 0, 'tok/s')}`),
        );
      },
    }),
    xAxis: figureXAxis({ min: 0, max: spanMs, caption: 'wall-clock ms' }),
    yAxis: zeroBasedYAxis(peak, 'tok/s per bin'),
    series: [
      ruleSeries([{ yAxis: peak, dashed: false, color: tokens.hair }]),
      ...lane('measured', MEASURED_COLOR, bins.measuredOutputTps, means.measured),
      ...lane('modelled', MODELLED_COLOR, bins.simulatedOutputTps, means.simulated),
    ],
  };
}

// ---- what each side scheduled, over its own clock or iteration ids --------

/**
 * One metric of the schedule with every recorded iteration preserved. In
 * elapsed-time mode, a step holds an iteration's value until the next
 * iteration starts, so a long iteration remains visible instead of becoming
 * an artificial gap. Iteration-id mode uses each side's original ids. The two
 * sides are overlaid but never paired.
 */
export function workloadShapeOption(card: WorkloadCardModel): EChartsOption | null {
  if (card.measured === null && card.simulated === null) return null;
  let highest = 0;
  if (card.measured !== null) highest = maxValue(card.measured.points.values, highest);
  if (card.simulated !== null) highest = maxValue(card.simulated.points.values, highest);
  const peak = highest * 1.08 || 1;

  const lane = (
    name: string,
    color: string,
    side: WorkloadCardModel['measured'],
  ): LineSeriesOption[] => {
    if (side === null) return [];
    return [
      {
        name,
        type: 'line',
        step: 'end',
        showSymbol: false,
        animation: false,
        lineStyle: { width: 1.3, color, join: 'round' },
        itemStyle: { color },
        data: side.points.x.map((coordinate, index) => [coordinate, side.points.values[index]]),
      },
    ];
  };

  return {
    animation: false,
    legend: { show: false },
    grid: { left: 46, right: 14, top: 20, bottom: 30 },
    tooltip: richTextTooltip(CHART_THEME, 'axis', {
      formatter: (parameters: unknown) => {
        const rows = (Array.isArray(parameters) ? parameters : [parameters]) as {
          seriesName?: string;
          data?: [number, number];
        }[];
        return tooltipLines(
          rows
            .filter((row) => !(row.seriesName ?? '').includes('envelope'))
            .map(
              (row) =>
                `${row.seriesName ?? ''} ${fmtQuantity(row.data?.[1] ?? 0, card.quantityUnit)}`,
            ),
        );
      },
    }),
    xAxis: figureXAxis({
      min: card.axisMin,
      max: card.axisMax,
      caption: card.axisMode === 'elapsedTime' ? 'elapsed time (s)' : 'iteration ID',
    }),
    yAxis: zeroBasedYAxis(peak, card.unit),
    series: [
      ruleSeries([{ yAxis: peak, dashed: false, color: tokens.hair }]),
      ...lane('measured', MEASURED_COLOR, card.measured),
      ...lane('modelled', MODELLED_COLOR, card.simulated),
    ],
  };
}

/** A full-screen copy of a whole-run figure with navigation controls.
 * The compact card remains an unencumbered overview; the expanded chart can
 * be zoomed with the wheel, panned by dragging, or scrubbed with the slider. */
export function expandedWholeRunOption(option: EChartsOption): EChartsOption {
  return {
    ...option,
    grid: { ...(option.grid as object), bottom: 72 },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 20,
        bottom: 16,
        borderColor: tokens.hair,
        fillerColor: `${tokens.teal}24`,
        handleStyle: { color: tokens.teal, borderColor: tokens.teal },
        moveHandleStyle: { color: tokens.teal },
        dataBackground: {
          lineStyle: { color: tokens.sub2 },
          areaStyle: { color: `${tokens.sub2}18` },
        },
        selectedDataBackground: {
          lineStyle: { color: tokens.teal },
          areaStyle: { color: `${tokens.teal}20` },
        },
        textStyle: { color: tokens.sub, fontFamily: tokens.mono, fontSize: chartFont(9) },
      },
    ],
  };
}
