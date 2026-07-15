import type { EChartsOption } from 'echarts';
import type { TraceOverviewData } from '../data/runOverview';
import type { ChartTheme } from './options';

function tokenLabel(value: number): string {
  if (value >= 1024) return `${+(value / 1024).toFixed(value >= 10240 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function lengthDistributionOption(data: TraceOverviewData, theme: ChartTheme): EChartsOption {
  const input = data.tokenLengths.map((tokens, index) => [tokens, data.inputDensity[index]]);
  const output = data.tokenLengths.map((tokens, index) => [tokens, -data.outputDensity[index]]);
  return {
    animationDuration: 450,
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: { left: 38, right: 16, top: 26, bottom: 34 },
    legend: {
      top: 0, right: 0, data: ['input lens', 'output lens'],
      textStyle: { color: theme.sub, fontSize: 10 }, itemWidth: 12, itemHeight: 7,
    },
    tooltip: {
      trigger: 'axis', backgroundColor: theme.tip, borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: theme.font, fontSize: 11 },
      formatter: (params: unknown) => {
        const rows = params as Array<{ seriesName: string; value: [number, number]; marker: string }>;
        const tokens = rows[0]?.value[0] ?? 0;
        return [`<b>${tokenLabel(tokens)} tokens</b>`, ...rows.map((row) => `${row.marker}${row.seriesName}: ${Math.abs(row.value[1]).toFixed(2)}`)].join('<br/>');
      },
    },
    xAxis: {
      type: 'log', min: 4, max: 32768, name: 'sequence length · tokens', nameLocation: 'middle', nameGap: 24,
      nameTextStyle: { color: theme.sub, fontSize: 9 },
      axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
      axisLabel: { color: theme.sub, fontSize: 9, formatter: tokenLabel }, splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: -1.05, max: 1.05, interval: 0.5,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: theme.sub, fontSize: 9, formatter: (value: number) => Math.abs(value).toFixed(1) },
      splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
    },
    series: [
      {
        name: 'input lens', type: 'line', smooth: 0.38, symbol: 'none', data: input,
        lineStyle: { width: 1.8, color: theme.palette[0] },
        areaStyle: { color: theme.palette[0], opacity: 0.28, origin: 'auto' },
      },
      {
        name: 'output lens', type: 'line', smooth: 0.38, symbol: 'none', data: output,
        lineStyle: { width: 1.8, color: theme.palette[1] },
        areaStyle: { color: theme.palette[1], opacity: 0.28, origin: 'auto' },
      },
    ],
  };
}

export function arrivalPatternOption(data: TraceOverviewData, theme: ChartTheme): EChartsOption {
  return {
    animationDuration: 450,
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: { left: 38, right: 16, top: 26, bottom: 34 },
    legend: {
      top: 0, right: 0, data: ['arrivals', 'local mean'],
      textStyle: { color: theme.sub, fontSize: 10 }, itemWidth: 12, itemHeight: 7,
    },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: theme.tip, borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: theme.font, fontSize: 11 },
    },
    xAxis: {
      type: 'value', name: 'wall-clock · s', nameLocation: 'middle', nameGap: 24,
      nameTextStyle: { color: theme.sub, fontSize: 9 },
      axisLine: { lineStyle: { color: theme.axis } }, axisTick: { show: false },
      axisLabel: { color: theme.sub, fontSize: 9 }, splitLine: { show: false },
    },
    yAxis: {
      type: 'value', name: 'req / bucket', nameTextStyle: { color: theme.sub, fontSize: 9 },
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: theme.sub, fontSize: 9 },
      splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
    },
    series: [
      {
        name: 'arrivals', type: 'bar', barMaxWidth: 9,
        data: data.arrivalSeconds.map((seconds, index) => [seconds, data.arrivals[index]]),
        itemStyle: { color: theme.palette[1], opacity: 0.72, borderRadius: [2, 2, 0, 0] },
      },
      {
        name: 'local mean', type: 'line', smooth: true, symbol: 'none',
        data: data.arrivalSeconds.map((seconds, index) => [seconds, data.arrivalTrend[index]]),
        lineStyle: { color: theme.palette[0], width: 2.1 },
      },
    ],
  };
}
