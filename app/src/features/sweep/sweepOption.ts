import { chartFont } from '../../theme/metrics';
import type { EChartsOption } from 'echarts';

import { CHART_THEME, chartGrid } from '../../charts/platform';
import type {
  SweepAnalysis,
  SweepCoordinateValue,
  SweepMetric,
  SweepRun,
} from '../../domain/sweep';
import { tokens, withAlpha, colors } from '../../theme';

export const SWEEP_OUTCOME_SCALE = [
  colors.sweepLow,
  colors.sweepMidLow,
  colors.sweepMidHigh,
  colors.sweepHigh,
  tokens.teal,
] as const;

export interface SweepFacet {
  key: string;
  label: string;
  runs: readonly SweepRun[];
}

function coordinateKey(value: SweepCoordinateValue): string {
  return JSON.stringify(value);
}

export function runCoordinateKey(analysis: SweepAnalysis, run: SweepRun): string {
  return analysis.axes
    .map((axis) => `${axis}:${coordinateKey(run.coordinates[axis] ?? null)}`)
    .join('|');
}

export function coordinateLabel(value: SweepCoordinateValue): string {
  if (Array.isArray(value)) return value.map(String).join(' × ');
  if (value === null) return 'null';
  return String(value);
}

/** Keep engineering-scale ticks legible without letting long values escape a compact panel. */
export function sweepAxisTickLabel(value: string | number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) < 1_000) {
    return String(value);
  }
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function sweepFacets(analysis: SweepAnalysis): readonly SweepFacet[] {
  const facetAxes = analysis.axes.slice(2);
  if (facetAxes.length === 0) return [{ key: 'all', label: 'All runs', runs: analysis.runs }];
  const grouped = new Map<string, SweepRun[]>();
  analysis.runs.forEach((run) => {
    const key = facetAxes
      .map((axis) => `${axis}:${coordinateKey(run.coordinates[axis] ?? null)}`)
      .join('|');
    const facetRuns = grouped.get(key);
    if (facetRuns) facetRuns.push(run);
    else grouped.set(key, [run]);
  });
  return Array.from(grouped, ([key, runs]) => ({
    key,
    label: facetAxes
      .map((axis) => `${axis} ${coordinateLabel(runs[0]?.coordinates[axis] ?? null)}`)
      .join(' · '),
    runs,
  }));
}

export function sweepMetricDisplayValue(metric: SweepMetric, value: number): number {
  return metric.key === 'gpu_utilization' ? value * 100 : value;
}

export function formatMetricValue(metric: SweepMetric, value: number | null | undefined): string {
  if (value === null || value === undefined) return 'missing';
  const displayed = sweepMetricDisplayValue(metric, value);
  const digits = Math.abs(displayed) >= 100 ? 0 : Math.abs(displayed) >= 10 ? 1 : 2;
  return `${displayed.toLocaleString(undefined, { maximumFractionDigits: digits })} ${metric.unit}`;
}

export function sweepMetricBounds(
  metric: SweepMetric,
  runs: readonly SweepRun[],
): [number, number] {
  const values = runs
    .map((run) => run.metrics[metric.key])
    .filter((value): value is number => value !== null && value !== undefined)
    .map((value) => sweepMetricDisplayValue(metric, value));
  if (values.length === 0) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum ? [minimum * 0.95, maximum * 1.05 || 1] : [minimum, maximum];
}

export function sweepChartOption(
  analysis: SweepAnalysis,
  metric: SweepMetric,
  facet: SweepFacet,
  selectedRunKey: string | null,
): EChartsOption {
  const [minimum, maximum] = sweepMetricBounds(metric, analysis.runs);
  const xAxisName = analysis.axes[0];
  const xDomain = analysis.domains[xAxisName] ?? [];
  if (analysis.axes.length === 1) {
    const indexedRuns = new Map(
      facet.runs.map((run) => [coordinateKey(run.coordinates[xAxisName] ?? null), run]),
    );
    return {
      animationDuration: 260,
      grid: chartGrid({ left: 72, right: 20, top: 24, bottom: 64 }),
      tooltip: { show: false },
      xAxis: {
        type: 'category',
        name: xAxisName,
        nameLocation: 'middle',
        nameGap: 38,
        nameTextStyle: {
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: chartFont(12),
          fontWeight: 600,
        },
        data: xDomain.map(coordinateLabel),
        axisTick: { show: false },
        axisLabel: {
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: chartFont(13),
          fontWeight: 500,
          formatter: sweepAxisTickLabel,
        },
        axisLine: { lineStyle: { color: CHART_THEME.axis } },
      },
      yAxis: {
        type: 'value',
        name: metric.unit,
        nameLocation: 'middle',
        nameGap: 54,
        // Let ECharts choose human-scale ticks. Pinning the raw extrema emits
        // labels such as `319.10833333333335`, which escape compact cards.
        scale: true,
        nameTextStyle: {
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: chartFont(12),
          fontWeight: 600,
        },
        axisLabel: {
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: chartFont(13),
          fontWeight: 500,
          formatter: sweepAxisTickLabel,
        },
        splitLine: { lineStyle: { color: CHART_THEME.split, type: 'dashed' } },
      },
      series: [
        {
          type: 'line',
          smooth: 0.18,
          symbolSize: 8,
          lineStyle: { width: 2, color: tokens.teal },
          itemStyle: { color: tokens.teal, borderColor: tokens.tile, borderWidth: 2 },
          data: xDomain.map((coordinate, index) => {
            const run = indexedRuns.get(coordinateKey(coordinate));
            const value = run?.metrics[metric.key];
            const runKey = run ? runCoordinateKey(analysis, run) : null;
            const selected = runKey !== null && runKey === selectedRunKey;
            return {
              value: [index, value == null ? null : sweepMetricDisplayValue(metric, value)],
              runId: run?.runId ?? null,
              runKey,
              coordinates: run?.coordinates,
              symbolSize: selected ? 13 : 8,
              itemStyle: selected
                ? {
                    color: tokens.tile,
                    borderColor: tokens.teal,
                    borderWidth: 4,
                    shadowBlur: 9,
                    shadowColor: withAlpha(tokens.teal, 0.38),
                  }
                : undefined,
            };
          }),
        },
      ],
    };
  }

  const yAxisName = analysis.axes[1];
  const yDomain = analysis.domains[yAxisName] ?? [];
  const xIndexes = new Map(xDomain.map((value, index) => [coordinateKey(value), index]));
  const yIndexes = new Map(yDomain.map((value, index) => [coordinateKey(value), index]));
  const data = facet.runs.flatMap((run) => {
    const metricValue = run.metrics[metric.key];
    const xIndex = xIndexes.get(coordinateKey(run.coordinates[xAxisName] ?? null));
    const yIndex = yIndexes.get(coordinateKey(run.coordinates[yAxisName] ?? null));
    if (metricValue == null || xIndex === undefined || yIndex === undefined) return [];
    return [
      {
        value: [xIndex, yIndex, sweepMetricDisplayValue(metric, metricValue)],
        runId: run.runId,
        runKey: runCoordinateKey(analysis, run),
        coordinates: run.coordinates,
        simulation: run.lifecycle.simulation,
        analysis: run.lifecycle.analysis,
      },
    ];
  });
  const selectedDatum = data.find((datum) => datum.runKey === selectedRunKey);
  const minimizes = metric.objective === 'minimize';
  return {
    animationDuration: 260,
    grid: chartGrid({ left: 78, right: 60, top: 12, bottom: 50 }),
    tooltip: { show: false },
    xAxis: {
      type: 'category',
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: {
        color: tokens.ink,
        fontFamily: tokens.body,
        fontSize: chartFont(12),
        fontWeight: 600,
      },
      data: xDomain.map(coordinateLabel),
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontFamily: tokens.body,
        fontSize: chartFont(13),
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: CHART_THEME.axis } },
    },
    yAxis: {
      type: 'category',
      name: yAxisName,
      nameLocation: 'middle',
      nameGap: 54,
      nameTextStyle: {
        color: tokens.ink,
        fontFamily: tokens.body,
        fontSize: chartFont(12),
        fontWeight: 600,
      },
      data: yDomain.map(coordinateLabel),
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontFamily: tokens.body,
        fontSize: chartFont(13),
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: CHART_THEME.axis } },
    },
    visualMap: {
      seriesIndex: 0,
      min: minimum,
      max: maximum,
      orient: 'vertical',
      right: 1,
      top: 'middle',
      itemHeight: 92,
      itemWidth: 9,
      calculable: false,
      text: minimizes ? ['worse', 'better'] : ['better', 'worse'],
      textGap: 3,
      textStyle: { color: tokens.sub, fontFamily: tokens.body, fontSize: chartFont(9) },
      inRange: {
        color: minimizes ? [...SWEEP_OUTCOME_SCALE].reverse() : [...SWEEP_OUTCOME_SCALE],
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: chartFont(10),
          formatter: (params: unknown) => {
            const value = (params as { value?: readonly [number, number, number] }).value?.[2];
            if (value === undefined) return '';
            return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
          },
        },
        itemStyle: { borderColor: tokens.tile, borderWidth: 3, borderRadius: 5 },
        emphasis: { itemStyle: { borderColor: tokens.teal, borderWidth: 2 } },
      },
      {
        // A custom overlay owns an inset selection ring. A second heatmap
        // series is not reliable here because its cell border can still be
        // merged or clipped by the SVG heatmap painter.
        type: 'custom',
        coordinateSystem: 'cartesian2d',
        silent: true,
        z: 20,
        data: selectedDatum ? [[selectedDatum.value[0], selectedDatum.value[1]]] : [],
        tooltip: { show: false },
        renderItem: (_params, api) => {
          const center = api.coord([api.value(0), api.value(1)]);
          const measuredCellSize = api.size?.([1, 1]) ?? [0, 0];
          const cellWidth = Array.isArray(measuredCellSize)
            ? Math.abs(measuredCellSize[0] ?? 0)
            : Math.abs(measuredCellSize);
          const cellHeight = Array.isArray(measuredCellSize)
            ? Math.abs(measuredCellSize[1] ?? measuredCellSize[0] ?? 0)
            : Math.abs(measuredCellSize);
          const lineWidth = 3;
          const inset = lineWidth / 2;
          return {
            type: 'rect',
            shape: {
              x: center[0] - cellWidth / 2 + inset,
              y: center[1] - cellHeight / 2 + inset,
              width: Math.max(0, cellWidth - inset * 2),
              height: Math.max(0, cellHeight - inset * 2),
              r: 4,
            },
            style: {
              fill: 'transparent',
              stroke: tokens.teal,
              lineWidth,
              shadowBlur: 10,
              shadowColor: withAlpha(tokens.teal, 0.42),
            },
          };
        },
      },
    ],
  };
}
