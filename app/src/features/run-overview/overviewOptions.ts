import type { EChartsOption } from 'echarts';
import type { TraceOverviewData } from './model';
import {
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  tooltipLines,
  type ChartTheme,
} from '../../charts/platform';

function tokenLabel(value: number): string {
  if (value >= 1024) return `${+(value / 1024).toFixed(value >= 10240 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function lengthDistributionOption(
  data: TraceOverviewData,
  theme: ChartTheme,
): EChartsOption {
  const input = data.tokenLengths.map((tokens, index) => [tokens, data.inputDensity[index]]);
  const output = data.tokenLengths.map((tokens, index) => [tokens, -data.outputDensity[index]]);
  return {
    animationDuration: 450,
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: chartGrid({ left: 38, right: 16, top: 26, bottom: 34 }),
    legend: {
      top: 0,
      right: 0,
      data: ['input lens', 'output lens'],
      textStyle: { color: theme.sub, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 7,
    },
    tooltip: richTextTooltip(theme, 'axis', {
      textStyle: { fontSize: 11 },
      formatter: (params: unknown) => {
        const rows = params as Array<{
          seriesName: string;
          value: [number, number];
        }>;
        const tokens = rows[0]?.value[0] ?? 0;
        return tooltipLines([
          `${tokenLabel(tokens)} tokens`,
          ...rows.map((row) => `${row.seriesName}: ${Math.abs(row.value[1]).toFixed(2)}`),
        ]);
      },
    }),
    xAxis: {
      type: 'log',
      min: 4,
      max: 32768,
      name: 'sequence length · tokens',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: theme.sub, fontSize: 9 },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: { color: theme.sub, fontSize: 9, formatter: tokenLabel },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: -1.05,
      max: 1.05,
      interval: 0.5,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.sub,
        fontSize: 9,
        formatter: (value: number) => Math.abs(value).toFixed(1),
      },
      splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
    },
    series: [
      {
        name: 'input lens',
        type: 'line',
        smooth: 0.38,
        symbol: 'none',
        data: input,
        lineStyle: { width: 1.8, color: theme.palette[0] },
        areaStyle: { color: theme.palette[0], opacity: 0.28, origin: 'auto' },
      },
      {
        name: 'output lens',
        type: 'line',
        smooth: 0.38,
        symbol: 'none',
        data: output,
        lineStyle: { width: 1.8, color: theme.palette[1] },
        areaStyle: { color: theme.palette[1], opacity: 0.28, origin: 'auto' },
      },
    ],
  };
}

export function arrivalPatternOption(data: TraceOverviewData, theme: ChartTheme): EChartsOption {
  // Arrival samples sit at uniformly spaced bucket centers. Convert counts to
  // req/s here so the chart communicates a rate instead of exposing the
  // analyzer's internal bucket size. A single-point trace has no measurable
  // bucket width, so its configured/effective request rate is the only exact
  // rate available.
  const bucketWidthSeconds =
    data.arrivalSeconds.length > 1 ? data.arrivalSeconds[1] - data.arrivalSeconds[0] : null;
  const requestRates = data.arrivals.map((count) =>
    bucketWidthSeconds !== null && bucketWidthSeconds > 0
      ? count / bucketWidthSeconds
      : data.requestRate,
  );
  return {
    animationDuration: 450,
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: chartGrid({ left: 38, right: 16, top: 26, bottom: 34 }),
    legend: {
      top: 0,
      right: 0,
      data: ['effective request rate'],
      textStyle: { color: theme.sub, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 7,
    },
    tooltip: richTextTooltip(theme, 'axis', {
      axisPointer: { type: 'line' },
      textStyle: { fontSize: 11 },
    }),
    xAxis: {
      type: 'value',
      name: 'wall-clock · s',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: theme.sub, fontSize: 9 },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: { color: theme.sub, fontSize: 9 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'req/s',
      nameTextStyle: { color: theme.sub, fontSize: 9 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.sub, fontSize: 9 },
      splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
    },
    series: [
      {
        name: 'effective request rate',
        type: 'line',
        symbol: 'none',
        data: data.arrivalSeconds.map((seconds, index) => [seconds, requestRates[index]]),
        lineStyle: { color: theme.palette[0], width: 2.1 },
      },
    ],
  };
}
