import type { EChartsOption } from 'echarts';

import type { Slo, Throughput } from '../../domain/run';
import {
  baseChartOption,
  cursorMarker,
  safeChartText,
  type ChartTheme,
} from '../../charts/platform';

export function sloOption(slo: Slo, t: ChartTheme): EChartsOption {
  const keys: (keyof Slo)[] = ['ttft', 'tpot', 'e2e'];
  const series = keys.map((k, i) => {
    const s = slo[k];
    const col = t.palette[i % t.palette.length];
    return {
      name: safeChartText(`${s.label} (${s.unit})`),
      type: 'line' as const,
      smooth: true,
      symbol: 'none',
      data: s.x.map((x, j) => [x, s.y_pct[j]]),
      lineStyle: { width: 2.4, color: col },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: col, opacity: 0.5, type: 'dotted' as const },
        label: { formatter: 'p90', color: t.sub, fontSize: 10 },
        data: [{ xAxis: s.markers.p90 }],
      },
    };
  });
  const opt = baseChartOption(t);
  return {
    ...opt,
    xAxis: {
      ...(opt.xAxis as object),
      type: 'log',
      min: 1,
      name: 'latency',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    yAxis: {
      ...(opt.yAxis as object),
      max: 100,
      name: 'CDF %',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series,
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
    xAxis: { ...(opt.xAxis as object), name: 's', nameTextStyle: { color: t.sub, fontSize: 10 } },
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
