import type { EChartsOption } from 'echarts';

import { CHART_THEME, chartGrid } from '../../charts/platform';
import type {
  SweepAnalysis,
  SweepCoordinateValue,
  SweepMetric,
  SweepRun,
} from '../../domain/sweep';
import { tokens } from '../../theme';

const OUTCOME_SCALE = ['#edf3f5', '#d7e7ed', '#b7d2de', '#8eb8ca', '#5f91aa'] as const;

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

function displayValue(metric: SweepMetric, value: number): number {
  return metric.key === 'gpu_utilization' ? value * 100 : value;
}

export function formatMetricValue(metric: SweepMetric, value: number | null | undefined): string {
  if (value === null || value === undefined) return 'missing';
  const displayed = displayValue(metric, value);
  const digits = Math.abs(displayed) >= 100 ? 0 : Math.abs(displayed) >= 10 ? 1 : 2;
  return `${displayed.toLocaleString(undefined, { maximumFractionDigits: digits })} ${metric.unit}`;
}

function metricBounds(metric: SweepMetric, runs: readonly SweepRun[]): [number, number] {
  const values = runs
    .map((run) => run.metrics[metric.key])
    .filter((value): value is number => value !== null && value !== undefined)
    .map((value) => displayValue(metric, value));
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
  const [minimum, maximum] = metricBounds(metric, analysis.runs);
  const xAxisName = analysis.axes[0];
  const xDomain = analysis.domains[xAxisName] ?? [];
  if (analysis.axes.length === 1) {
    const indexedRuns = new Map(
      facet.runs.map((run) => [coordinateKey(run.coordinates[xAxisName] ?? null), run]),
    );
    return {
      animationDuration: 260,
      grid: chartGrid({ left: 72, right: 24, top: 28, bottom: 60 }),
      tooltip: { show: false },
      xAxis: {
        type: 'category',
        name: xAxisName,
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          color: tokens.ink,
          fontFamily: tokens.mono,
          fontSize: 12,
          fontWeight: 600,
        },
        data: xDomain.map(coordinateLabel),
        axisTick: { show: false },
        axisLabel: {
          color: tokens.ink,
          fontFamily: tokens.mono,
          fontSize: 13,
          fontWeight: 500,
        },
        axisLine: { lineStyle: { color: CHART_THEME.axis } },
      },
      yAxis: {
        type: 'value',
        name: metric.unit,
        min: minimum,
        max: maximum,
        nameTextStyle: {
          color: tokens.ink,
          fontFamily: tokens.mono,
          fontSize: 12,
          fontWeight: 600,
        },
        axisLabel: {
          color: tokens.ink,
          fontFamily: tokens.mono,
          fontSize: 13,
          fontWeight: 500,
        },
        splitLine: { lineStyle: { color: CHART_THEME.split, type: 'dashed' } },
      },
      series: [
        {
          type: 'line',
          smooth: 0.18,
          symbolSize: 8,
          lineStyle: { width: 2, color: '#4f829c' },
          itemStyle: { color: '#4f829c', borderColor: tokens.tile, borderWidth: 2 },
          data: xDomain.map((coordinate, index) => {
            const run = indexedRuns.get(coordinateKey(coordinate));
            const value = run?.metrics[metric.key];
            const runKey = run ? runCoordinateKey(analysis, run) : null;
            const selected = runKey !== null && runKey === selectedRunKey;
            return {
              value: [index, value == null ? null : displayValue(metric, value)],
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
                    shadowColor: 'rgba(31,111,107,.38)',
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
        value: [xIndex, yIndex, displayValue(metric, metricValue)],
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
    grid: chartGrid({ left: 96, right: 84, top: 22, bottom: 64 }),
    tooltip: { show: false },
    xAxis: {
      type: 'category',
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: {
        color: tokens.ink,
        fontFamily: tokens.mono,
        fontSize: 12,
        fontWeight: 600,
      },
      data: xDomain.map(coordinateLabel),
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontFamily: tokens.mono,
        fontSize: 13,
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: CHART_THEME.axis } },
    },
    yAxis: {
      type: 'category',
      name: yAxisName,
      nameLocation: 'middle',
      nameGap: 70,
      nameTextStyle: {
        color: tokens.ink,
        fontFamily: tokens.mono,
        fontSize: 12,
        fontWeight: 600,
      },
      data: yDomain.map(coordinateLabel),
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontFamily: tokens.mono,
        fontSize: 13,
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: CHART_THEME.axis } },
    },
    visualMap: {
      seriesIndex: 0,
      min: minimum,
      max: maximum,
      orient: 'vertical',
      right: 8,
      top: 'middle',
      itemHeight: 116,
      itemWidth: 9,
      calculable: false,
      text: minimizes ? ['worse', 'better'] : ['better', 'worse'],
      textGap: 5,
      textStyle: { color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 },
      inRange: { color: minimizes ? [...OUTCOME_SCALE].reverse() : [...OUTCOME_SCALE] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          color: tokens.ink,
          fontFamily: tokens.mono,
          fontSize: 10,
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
              shadowColor: 'rgba(31,111,107,.42)',
            },
          };
        },
      },
    ],
  };
}
