import type { EChartsOption } from 'echarts';

import type { ThroughputTimeline, ThroughputTimelineView } from '../../artifacts';
import { baseChartOption, cursorMarker, type ChartTheme } from '../../ui/charts/platform';
import { chartFont } from '../../ui/theme/metrics';

export interface ThroughputChartData {
  readonly startMs: readonly number[];
  readonly endMs: readonly number[];
  readonly total: readonly number[];
  readonly prefill: readonly number[];
  readonly decode: readonly number[];
}

/** Select a producer view and restore the cluster rates used by the old chart. */
export function throughputChartData(
  timeline: ThroughputTimeline,
  resolution: 'fine' | 'coarse' = 'fine',
): ThroughputChartData {
  const view = resolution === 'coarse' ? (timeline.coarse ?? timeline.fine) : timeline.fine;
  const values = (key: 'total' | 'prefill' | 'decode') =>
    requiredSeries(view, key).perGpu.map((value) => value * timeline.gpus);
  return {
    startMs: view.startMs,
    endMs: view.endMs,
    total: values('total'),
    prefill: values('prefill'),
    decode: values('decode'),
  };
}

function requiredSeries(view: ThroughputTimelineView, key: string) {
  const series = view.series.find((candidate) => candidate.key === key);
  if (series === undefined) throw new Error(`parsed throughput timeline is missing ${key}`);
  return series;
}

/** Existing throughput step chart moved behind its panel boundary. */
export function throughputOption(
  data: ThroughputChartData,
  theme: ChartTheme,
  cursorSeconds?: number,
): EChartsOption {
  const firstStartSeconds = data.startMs[0] / 1000;
  const finalEndSeconds = data.endMs[data.endMs.length - 1] / 1000;
  const intervalSteps = (values: readonly number[]): [number, number][] => [
    ...data.startMs.map((startMs, index) => [startMs / 1000, values[index]] as [number, number]),
    [finalEndSeconds, values[values.length - 1]],
  ];
  const series = (
    name: string,
    values: readonly number[],
    color: string,
    width: number,
    z: number,
  ) => ({
    name,
    type: 'line' as const,
    step: 'end' as const,
    symbol: 'none',
    lineStyle: { width, color },
    color,
    z,
    data: intervalSteps(values),
  });
  const base = baseChartOption(theme);
  return {
    ...base,
    grid: { ...(base.grid as object), containLabel: true },
    xAxis: {
      ...(base.xAxis as object),
      min: firstStartSeconds,
      max: finalEndSeconds,
      name: 'wall-clock · s',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(base.yAxis as object),
      name: 'tok/s',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      series('total', data.total, theme.palette[0], 3.2, 3),
      series('prefill', data.prefill, theme.palette[1], 1.6, 4),
      series('decode', data.decode, theme.palette[2], 1.6, 4),
      ...(cursorSeconds != null ? [cursorMarker(cursorSeconds)] : []),
    ],
  };
}
