import type { EChartsOption } from 'echarts';

import type { SloMetric, Throughput } from '../../domain/run';
import {
  baseChartOption,
  cursorMarker,
  safeChartText,
  type ChartTheme,
} from '../../charts/platform';

export function sloMetricOption(metric: SloMetric, t: ChartTheme, color: string): EChartsOption {
  const opt = baseChartOption(t);
  return {
    ...opt,
    xAxis: {
      ...(opt.xAxis as object),
      type: 'log',
      min: 1,
      name: `latency · ${safeChartText(metric.unit)}`,
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    yAxis: {
      ...(opt.yAxis as object),
      max: 100,
      name: 'CDF %',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      {
        name: safeChartText(`${metric.label} (${metric.unit})`),
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: metric.x.map((x, index) => [x, metric.y_pct[index]]),
        lineStyle: { width: 2.4, color },
        areaStyle: { color, opacity: 0.08 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color, opacity: 0.5, type: 'dotted' },
          label: { formatter: 'p90', color: t.sub, fontSize: 10 },
          data: [{ xAxis: metric.markers.p90 }],
        },
      },
    ],
  };
}

export function throughputOption(tp: Throughput, t: ChartTheme, cursorS?: number): EChartsOption {
  const x = tp.t_end_ms.map((v) => +(v / 1000).toFixed(1));
  const mk = (name: string, arr: number[], col: string) => ({
    name,
    type: 'line' as const,
    stack: 'tok',
    smooth: true,
    symbol: 'none',
    areaStyle: { opacity: 0.85, color: col },
    lineStyle: { width: 0 },
    color: col,
    data: arr.map((v, i) => [x[i], v]),
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
      name: 'wall-clock · s',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    yAxis: {
      ...(opt.yAxis as object),
      name: 'tok/s',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      mk('prefill', tp.prefill, t.palette[1]),
      mk('decode', tp.decode, t.palette[0]),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}
