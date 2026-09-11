import type { EChartsOption } from 'echarts';

import type { LatencyMarkers, LatencySeries } from '../../artifacts';
import {
  baseChartOption,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../ui/charts/platform';
import { chartFont } from '../../ui/theme/metrics';

/** The old empirical latency-CDF chart, projected from the location-first artifact. */
export function sloMetricOption(
  metric: LatencySeries & { readonly markers: LatencyMarkers },
  theme: ChartTheme,
  color: string,
): EChartsOption {
  const option = baseChartOption(theme);
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
    ...option,
    tooltip: richTextTooltip(theme, 'axis', {
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
      ...(option.xAxis as object),
      type: 'value',
      min: axisMin,
      max: axisMax,
      axisPointer: { snap: true },
      name: `latency · ${safeChartText(metric.unit)}`,
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(option.yAxis as object),
      max: 100,
      name: 'CDF %',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      {
        name: safeChartText(`${metric.label} (${metric.unit})`),
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: metric.x.map((x, index) => [x, metric.yPct[index]]),
        lineStyle: { width: 2.4, color },
        areaStyle: { color, opacity: 0.08 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color, opacity: 0.5, type: 'dotted' },
          label: { formatter: 'p90', color: theme.sub, fontSize: chartFont(10) },
          data: [{ xAxis: metric.markers.p90 }],
        },
      },
    ],
  };
}
