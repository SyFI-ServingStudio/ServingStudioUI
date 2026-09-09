import { chartFont } from '../../theme/metrics';
import type { EChartsOption } from 'echarts';

import {
  baseChartOption,
  chartAxisLine,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../charts/platform';
import type { RequestState } from '../../domain/run';

/** Cluster request populations share one stack. ECharts legend selection is
 * intentionally enabled so each category can be removed independently and
 * the remaining categories re-stack without mutating Analyzer data. */
export function clusterRequestStateOption(
  requestState: RequestState,
  theme: ChartTheme,
  cursorSeconds?: number,
): EChartsOption {
  const base = baseChartOption(theme);
  const xSeconds = requestState.tStartMs.map((value) => (value / 1000).toFixed(2));
  xSeconds.push((requestState.tEndMs[requestState.tEndMs.length - 1] / 1000).toFixed(2));
  const legendNames = requestState.clusterSeries.map((series) => safeChartText(series.category));
  const cursorCategory =
    cursorSeconds === undefined
      ? null
      : xSeconds.reduce((closest, value) =>
          Math.abs(Number(value) - cursorSeconds) < Math.abs(Number(closest) - cursorSeconds)
            ? value
            : closest,
        );
  const categoryColor = (category: string, sourceIndex: number): string => {
    if (category === 'done') return theme.sub;
    if (category === 'active') return theme.palette[0];
    if (category === 'pending') return theme.palette[1];
    if (category === 'transfer') return theme.palette[2];
    return theme.palette[(sourceIndex + 2) % theme.palette.length];
  };

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
      ...requestState.clusterSeries.map((category, sourceIndex) => {
        const values = [...category.values, category.values[category.values.length - 1]];
        const color = categoryColor(category.category, sourceIndex);
        const areaOpacity = category.category === 'done' ? 0.3 : 0.58;
        return {
          name: safeChartText(category.category),
          type: 'line' as const,
          color,
          stack: 'request-state-categories',
          step: 'end' as const,
          symbol: 'none',
          data: values,
          lineStyle: { width: category.category === 'active' ? 1.4 : 0.8, color, opacity: 0.9 },
          areaStyle: { color, opacity: areaOpacity },
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
