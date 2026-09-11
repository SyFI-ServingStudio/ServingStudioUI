import type { EChartsOption } from 'echarts';

import type {
  RequestStateTimeline,
  RequestStateTimelineCategory,
  RequestStateTimelinePool,
} from '../../artifacts';
import {
  baseChartOption,
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../ui/charts/platform';
import { chartFont } from '../../ui/theme/metrics';

function timeAxis(timeline: RequestStateTimeline): string[] {
  const seconds = timeline.tStartMs.map((value) => (value / 1000).toFixed(2));
  seconds.push((timeline.tEndMs[timeline.tEndMs.length - 1] / 1000).toFixed(2));
  return seconds;
}

function categoryColor(category: string, sourceIndex: number, theme: ChartTheme): string {
  if (category === 'done') return theme.sub;
  if (category === 'active') return theme.palette[0];
  if (category === 'pending') return theme.palette[1];
  if (category === 'transfer') return theme.palette[2];
  return theme.palette[(sourceIndex + 2) % theme.palette.length];
}

function endExtended(values: readonly number[]): number[] {
  return [...values, values[values.length - 1]];
}

/** Existing cluster request-state chart moved behind its panel boundary. */
export function clusterRequestStateOption(
  timeline: RequestStateTimeline,
  theme: ChartTheme,
  cursorSeconds?: number,
): EChartsOption {
  const base = baseChartOption(theme);
  const xSeconds = timeAxis(timeline);
  const legendNames = timeline.clusterSeries.map((series) => safeChartText(series.category));
  const cursorCategory =
    cursorSeconds === undefined
      ? null
      : xSeconds.reduce((closest, value) =>
          Math.abs(Number(value) - cursorSeconds) < Math.abs(Number(closest) - cursorSeconds)
            ? value
            : closest,
        );

  return {
    ...base,
    legend: {
      ...(base.legend as object),
      data: legendNames,
      selectedMode: 'multiple',
    },
    tooltip: richTextTooltip(theme, 'axis', {
      formatter: (params: unknown) => {
        const rows = params as Array<{
          axisValue: number;
          seriesName: string;
          value: number;
        }>;
        return tooltipLines([
          `${Number(rows[0]?.axisValue ?? 0).toFixed(1)}s`,
          ...rows.map((row) => `${row.seriesName}: ${Number(row.value ?? 0).toFixed(1)} requests`),
        ]);
      },
    }),
    xAxis: {
      type: 'category',
      data: xSeconds,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: {
        color: theme.sub,
        fontSize: chartFont(11),
        formatter: (value: string) => `${+Number(value).toFixed(1)}`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: 'requests',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      ...timeline.clusterSeries.map((category, sourceIndex) => {
        const color = categoryColor(category.category, sourceIndex, theme);
        return {
          name: safeChartText(category.category),
          type: 'line' as const,
          color,
          stack: 'request-state-categories',
          step: 'end' as const,
          symbol: 'none',
          data: endExtended(category.values),
          lineStyle: {
            width: category.category === 'active' ? 1.4 : 0.8,
            color,
            opacity: 0.9,
          },
          areaStyle: { color, opacity: category.category === 'done' ? 0.3 : 0.58 },
          emphasis: { focus: 'series' as const },
        };
      }),
      ...(cursorCategory === null
        ? []
        : [
            {
              type: 'line' as const,
              data: [] as number[],
              silent: true,
              showSymbol: false,
              animation: false,
              markLine: {
                silent: true,
                symbol: ['none', 'none'] as [string, string],
                lineStyle: { color: theme.palette[1], width: 1.5, opacity: 0.85 },
                label: {
                  formatter: 'iter',
                  color: theme.palette[1],
                  fontSize: chartFont(9),
                  position: 'start' as const,
                },
                data: [{ xAxis: cursorCategory }],
              },
            },
          ]),
    ],
  };
}

/** Existing pool aggregate, average, and worker chart moved behind its panel boundary. */
export function poolRequestStateOption(
  timeline: RequestStateTimeline,
  pool: RequestStateTimelinePool,
  theme: ChartTheme,
): EChartsOption {
  const base = baseChartOption(theme);
  const xSeconds = timeAxis(timeline);
  const aggregateName = 'pool aggregate';
  const averageName = 'worker average';
  const workerNames = pool.workers.map((worker) =>
    safeChartText(`worker ${worker.worker.workerId}`),
  );

  return {
    ...base,
    legend: {
      ...(base.legend as object),
      data: [aggregateName, averageName, ...workerNames],
      selectedMode: 'multiple',
    },
    grid: chartGrid({ left: 62, right: 18, top: 34, bottom: 30 }),
    tooltip: richTextTooltip(theme, 'axis', {
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; seriesName: string; value: number }>;
        return tooltipLines([
          `${Number(rows[0]?.axisValue ?? 0).toFixed(1)}s`,
          ...rows.map((row) => `${row.seriesName}: ${Number(row.value ?? 0).toFixed(1)} requests`),
        ]);
      },
    }),
    xAxis: {
      type: 'category',
      data: xSeconds,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: {
        color: theme.sub,
        fontSize: chartFont(11),
        formatter: (value: string) => `${+Number(value).toFixed(1)}`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: 'pending requests',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      {
        name: aggregateName,
        type: 'line' as const,
        color: theme.palette[1],
        step: 'end' as const,
        symbol: 'none',
        data: endExtended(pool.totalPending),
        lineStyle: { width: 2.8, color: theme.palette[1], opacity: 1 },
        z: 5,
      },
      {
        name: averageName,
        type: 'line' as const,
        color: theme.palette[0],
        step: 'end' as const,
        symbol: 'none',
        data: endExtended(pool.averagePending),
        lineStyle: { width: 2.1, color: theme.palette[0], type: 'dashed' as const, opacity: 1 },
        z: 4,
      },
      ...pool.workers.map((worker, index) => {
        const color = theme.palette[(index + 2) % theme.palette.length];
        return {
          name: workerNames[index],
          type: 'line' as const,
          color,
          step: 'end' as const,
          symbol: 'none',
          data: endExtended(worker.pending),
          lineStyle: { width: 1, color, opacity: 0.48 },
          emphasis: { focus: 'series' as const, lineStyle: { width: 2, opacity: 1 } },
          z: 2,
        };
      }),
    ],
  };
}

/** Existing selected-worker category stack moved behind its panel boundary. */
export function workerRequestStateOption(
  timeline: RequestStateTimeline,
  categories: readonly RequestStateTimelineCategory[],
  theme: ChartTheme,
): EChartsOption {
  const base = baseChartOption(theme);
  const xSeconds = timeAxis(timeline);
  const legendNames = categories.map((series) => safeChartText(series.category));

  return {
    ...base,
    legend: {
      ...(base.legend as object),
      data: legendNames,
      selectedMode: 'multiple',
    },
    tooltip: richTextTooltip(theme, 'axis', {
      formatter: (params: unknown) => {
        const rows = params as Array<{
          axisValue: string;
          seriesName: string;
          value: number;
        }>;
        return tooltipLines([
          `${Number(rows[0]?.axisValue ?? 0).toFixed(1)}s`,
          ...rows.map((row) => `${row.seriesName}: ${Number(row.value ?? 0).toFixed(1)} requests`),
        ]);
      },
    }),
    xAxis: {
      type: 'category',
      data: xSeconds,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: {
        color: theme.sub,
        fontSize: chartFont(11),
        formatter: (value: string) => `${+Number(value).toFixed(1)}`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: 'pending requests',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: categories.map((category, sourceIndex) => {
      const color = categoryColor(category.category, sourceIndex, theme);
      return {
        name: safeChartText(category.category),
        type: 'line' as const,
        color,
        stack: 'request-state-categories',
        step: 'end' as const,
        symbol: 'none',
        data: endExtended(category.values),
        lineStyle: {
          width: category.category === 'active' ? 1.4 : 0.8,
          color,
          opacity: 0.9,
        },
        areaStyle: { color, opacity: category.category === 'done' ? 0.3 : 0.58 },
        emphasis: { focus: 'series' as const },
      };
    }),
  };
}
