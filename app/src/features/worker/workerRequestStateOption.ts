import type { EChartsOption } from 'echarts';

import {
  baseChartOption,
  chartAxisLine,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../charts/platform';
import type { RequestState, RequestStateCategorySeries } from '../../domain/run';

/** Worker state payloads currently carry pending only. Render that evidence as
 * the same open-category stepped population stack used at cluster scope. */
export function workerRequestStateOption(
  requestState: RequestState,
  categories: RequestStateCategorySeries[],
  theme: ChartTheme,
): EChartsOption {
  const base = baseChartOption(theme);
  const xSeconds = requestState.tStartMs.map((value) => (value / 1000).toFixed(2));
  xSeconds.push((requestState.tEndMs[requestState.tEndMs.length - 1] / 1000).toFixed(2));
  const categoryColor = (category: string, sourceIndex: number): string => {
    if (category === 'done') return theme.sub;
    if (category === 'active') return theme.palette[0];
    if (category === 'pending') return theme.palette[1];
    if (category === 'transfer') return theme.palette[2];
    return theme.palette[(sourceIndex + 2) % theme.palette.length];
  };
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
      nameTextStyle: { color: theme.sub, fontSize: 10 },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: {
        color: theme.sub,
        fontSize: 11,
        formatter: (value: string) => `${+Number(value).toFixed(1)}`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: 'pending requests',
      nameTextStyle: { color: theme.sub, fontSize: 10 },
    },
    series: categories.map((category, sourceIndex) => {
      const color = categoryColor(category.category, sourceIndex);
      return {
        name: safeChartText(category.category),
        type: 'line' as const,
        color,
        stack: 'request-state-categories',
        step: 'end' as const,
        symbol: 'none',
        data: [...category.values, category.values[category.values.length - 1]],
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
