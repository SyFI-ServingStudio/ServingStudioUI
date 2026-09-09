import { chartFont } from '../theme/metrics';
import type { EChartsOption } from 'echarts';

import type { SloMetric, Throughput } from '../domain/run';
import {
  baseChartOption,
  cursorMarker,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../charts/platform';

export function sloMetricOption(metric: SloMetric, t: ChartTheme, color: string): EChartsOption {
  const opt = baseChartOption(t);
  const firstLatency = metric.x[0] ?? 0;
  const finalLatency = metric.x[metric.x.length - 1] ?? firstLatency;
  const latencySpan = finalLatency - firstLatency;
  const padding = latencySpan > 0 ? latencySpan * 0.04 : Math.max(Math.abs(firstLatency) * 0.04, 1);
  const axisMin = Math.max(0, firstLatency - padding);
  const axisMax = finalLatency + padding;
  const formatLatency = (value: number): string =>
    value.toLocaleString('en-US', {
      maximumFractionDigits: metric.unit === 'ms/token' ? 4 : 2,
    });
  return {
    ...opt,
    tooltip: richTextTooltip(t, 'axis', {
      axisPointer: { type: 'line', snap: true },
      formatter: (params: unknown) => {
        const row = (params as Array<{ value?: [number, number] }>)[0];
        const latency = Number(row?.value?.[0] ?? 0);
        const cumulativePct = Number(row?.value?.[1] ?? 0);
        return tooltipLines([
          `latency: ${formatLatency(latency)} ${metric.unit}`,
          `CDF: ${cumulativePct.toFixed(2)}%`,
        ]);
      },
    }),
    xAxis: {
      ...(opt.xAxis as object),
      type: 'value',
      min: axisMin,
      max: axisMax,
      axisPointer: { snap: true },
      name: `latency · ${safeChartText(metric.unit)}`,
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(opt.yAxis as object),
      max: 100,
      name: 'CDF %',
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    series: [
      {
        name: safeChartText(`${metric.label} (${metric.unit})`),
        type: 'line',
        // Visual smoothing does not change the empirical samples: the axis
        // pointer snaps to the original [latency, CDF] coordinates above.
        smooth: true,
        symbol: 'none',
        data: metric.x.map((x, index) => [x, metric.y_pct[index]]),
        lineStyle: { width: 2.4, color },
        areaStyle: { color, opacity: 0.08 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color, opacity: 0.5, type: 'dotted' },
          label: { formatter: 'p90', color: t.sub, fontSize: chartFont(10) },
          data: [{ xAxis: metric.markers.p90 }],
        },
      },
    ],
  };
}

export function throughputOption(tp: Throughput, t: ChartTheme, cursorS?: number): EChartsOption {
  const firstStartS = tp.t_start_ms[0] / 1000;
  const finalEndS = tp.t_end_ms[tp.t_end_ms.length - 1] / 1000;
  // Throughput values describe intervals, not samples at their end timestamps.
  // A final endpoint lets `step: end` hold the last value through its full bin.
  const intervalSteps = (values: number[]): [number, number][] => [
    ...tp.t_start_ms.map((startMs, index) => [startMs / 1000, values[index]] as [number, number]),
    [finalEndS, values[values.length - 1]],
  ];
  const mk = (name: string, values: number[], color: string, width: number, z: number) => ({
    name,
    type: 'line' as const,
    step: 'end' as const,
    symbol: 'none',
    lineStyle: { width, color },
    color,
    z,
    data: intervalSteps(values),
  });
  const opt = baseChartOption(t);
  return {
    ...opt,
    // The old end-positioned `s` label occupied the same bottom-right SVG
    // edge as the final tick. Let ECharts contain tick labels and center the
    // axis title so neither is clipped by the fixed chart viewport.
    grid: { ...(opt.grid as object), containLabel: true },
    xAxis: {
      ...(opt.xAxis as object),
      min: firstStartS,
      max: finalEndS,
      name: 'wall-clock · s',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(opt.yAxis as object),
      name: 'tok/s',
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    series: [
      // Keep the bold total behind its components: decode often equals total,
      // and the thin foreground stroke preserves both identities when they overlap.
      mk('total', tp.total, t.palette[0], 3.2, 3),
      mk('prefill', tp.prefill, t.palette[1], 1.6, 4),
      mk('decode', tp.decode, t.palette[2], 1.6, 4),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}
