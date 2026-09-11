import type { EChartsOption } from 'echarts';

import type { BatchTimelineMetricKey, BatchTimelineScope } from '../../artifacts';
import {
  baseChartOption,
  chartGrid,
  cursorMarker,
  richTextTooltip,
  type ChartTheme,
} from '../../ui/charts/platform';
import { chartFont } from '../../ui/theme/metrics';

export type BatchChartMetric = 'total_tokens' | 'prefill_tokens' | 'decode_requests';

export interface BatchChartSeries {
  readonly tMs: readonly number[];
  readonly batchTokens: readonly number[];
  readonly prefillTokens: readonly number[];
  readonly decodeRequests: readonly number[];
}

/** Project the three producer-defined signals without changing their samples. */
export function batchChartSeries(scope: BatchTimelineScope): BatchChartSeries {
  const values = (key: BatchTimelineMetricKey): readonly number[] => {
    const series = scope.series.find((candidate) => candidate.key === key);
    if (series === undefined) throw new Error(`parsed batch scope is missing ${key}`);
    return series.values;
  };
  return {
    tMs: scope.timeMs,
    batchTokens: values('batch_tokens'),
    prefillTokens: values('prefill_tokens'),
    decodeRequests: values('decode_request_count'),
  };
}

function metricView(batch: BatchChartSeries, metric: BatchChartMetric) {
  return {
    total_tokens: { name: 'total tokens', unit: 'tokens / invocation', values: batch.batchTokens },
    prefill_tokens: {
      name: 'prefill tokens',
      unit: 'tokens / invocation',
      values: batch.prefillTokens,
    },
    decode_requests: {
      name: 'decode requests',
      unit: 'requests / invocation',
      values: batch.decodeRequests,
    },
  }[metric];
}

/** Existing single-scope batch chart moved behind the batch panel boundary. */
export function batchMetricOption(
  batch: BatchChartSeries,
  metric: BatchChartMetric,
  theme: ChartTheme,
  cursorSeconds?: number,
): EChartsOption {
  const x = batch.tMs.map((value) => +(value / 1000).toFixed(3));
  const view = metricView(batch, metric);
  const base = baseChartOption(theme);
  return {
    ...base,
    tooltip: richTextTooltip(theme, 'axis', {
      valueFormatter: (value) => `${Number(value).toLocaleString('en-US')} ${view.unit}`,
    }),
    xAxis: {
      ...(base.xAxis as object),
      name: 's',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: view.unit,
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      {
        name: view.name,
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        data: view.values.map((value, index) => [x[index], value]),
        lineStyle: { width: 2.6, color: theme.palette[0], opacity: 1 },
        areaStyle: { color: theme.palette[0], opacity: 0.12 },
        z: 3,
      },
      ...(cursorSeconds != null ? [cursorMarker(cursorSeconds)] : []),
    ],
  };
}

/** Existing pool aggregate/average chart moved behind the batch panel boundary. */
export function poolBatchMetricOption(
  aggregate: BatchChartSeries,
  average: BatchChartSeries,
  metric: BatchChartMetric,
  theme: ChartTheme,
  cursorSeconds?: number,
): EChartsOption {
  const x = aggregate.tMs.map((value) => +(value / 1000).toFixed(3));
  const aggregateView = metricView(aggregate, metric);
  const averageView = metricView(average, metric);
  const base = baseChartOption(theme);
  return {
    ...base,
    legend: {
      top: 0,
      right: 0,
      data: ['pool aggregate', 'pool average'],
      textStyle: { color: theme.sub, fontSize: chartFont(11) },
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: chartGrid({ left: 62, right: 18, top: 34, bottom: 30 }),
    tooltip: richTextTooltip(theme, 'axis', {
      valueFormatter: (value) =>
        `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${aggregateView.unit}`,
    }),
    xAxis: {
      ...(base.xAxis as object),
      name: 's',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: aggregateView.unit.replace(' / invocation', ''),
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      {
        name: 'pool aggregate',
        type: 'line' as const,
        step: 'end' as const,
        symbol: 'none',
        data: aggregateView.values.map((value, index) => [x[index], value]),
        lineStyle: { width: 2.8, color: theme.palette[0], opacity: 1 },
        z: 4,
      },
      {
        name: 'pool average',
        type: 'line' as const,
        step: 'end' as const,
        symbol: 'none',
        data: averageView.values.map((value, index) => [x[index], value]),
        lineStyle: { width: 2, color: theme.palette[2], type: 'dashed' as const, opacity: 0.95 },
        z: 3,
      },
      ...(cursorSeconds != null ? [cursorMarker(cursorSeconds)] : []),
    ],
  };
}
