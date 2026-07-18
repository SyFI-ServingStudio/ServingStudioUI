import type { EChartsOption } from 'echarts';

import type { ScopedPendingQueue } from '../../application/runSelection';
import type { BatchSeries, KvSeries, UtilSeries } from '../../domain/run';
import { tokens } from '../../theme';
import {
  baseChartOption,
  chartAxisLine,
  chartGrid,
  cursorMarker,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../charts/platform';

export function utilizationOption(
  util: UtilSeries,
  t: ChartTheme,
  cursorS?: number,
): EChartsOption {
  const x = util.t_ms.map((v) => +(v / 1000).toFixed(1));
  const opt = baseChartOption(t);
  const poolIdentities = [
    ...new Set([
      ...util.series.map((series) => series.poolTag ?? series.key),
      ...util.workerSeries.map((series) => series.worker.poolTag),
    ]),
  ].sort();
  const colorFor = (identity: string): string =>
    t.palette[poolIdentities.indexOf(identity) % t.palette.length];
  const selectedWorkerOnly = util.series.length === 0 && util.workerSeries.length === 1;
  return {
    ...opt,
    xAxis: { ...(opt.xAxis as object), name: 's', nameTextStyle: { color: t.sub, fontSize: 10 } },
    yAxis: {
      ...(opt.yAxis as object),
      max: 100,
      name: 'busy %',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      ...util.workerSeries.map((series) => {
        const color = colorFor(series.worker.poolTag);
        const label =
          series.label.startsWith(`${series.worker.poolTag}/`) ||
          series.label.startsWith(`${series.worker.poolTag} ·`)
            ? series.label
            : `${series.worker.poolTag} · ${series.label}`;
        return {
          name: safeChartText(label),
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: series.util.map((value, index) => [x[index], +(value * 100).toFixed(1)]),
          lineStyle: {
            width: selectedWorkerOnly ? 3.4 : 1.1,
            color,
            opacity: selectedWorkerOnly ? 1 : 0.42,
          },
          emphasis: {
            focus: 'series' as const,
            lineStyle: { width: selectedWorkerOnly ? 4.2 : 2.1, opacity: 1 },
          },
          z: selectedWorkerOnly ? 4 : 2,
        };
      }),
      ...util.series.map((s) => {
        const color = colorFor(s.poolTag ?? s.key);
        const label =
          s.poolTag === undefined || s.label.toLowerCase() === s.poolTag.toLowerCase()
            ? s.label
            : `${s.poolTag} · ${s.label}`;
        return {
          name: safeChartText(`${label} average`),
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: s.util.map((v, j) => [x[j], +(v * 100).toFixed(1)]),
          lineStyle: { width: 3.4, color, opacity: 1 },
          z: 4,
        };
      }),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}

export function kvOption(kv: KvSeries, t: ChartTheme, cursorS?: number): EChartsOption {
  const x = kv.t_ms.map((v) => +(v / 1000).toFixed(1));
  const displayedSeries = [...kv.workerSeries, ...kv.series];
  const percentMode =
    displayedSeries.length > 0 && displayedSeries.every((series) => series.capacity !== null);
  const opt = baseChartOption(t);
  const poolIdentities = [
    ...new Set([
      ...kv.series.map((series) => series.poolTag ?? series.key),
      ...kv.workerSeries.map((series) => series.worker.poolTag),
    ]),
  ].sort();
  const colorFor = (identity: string): string =>
    t.palette[poolIdentities.indexOf(identity) % t.palette.length];
  const selectedWorkerOnly = kv.series.length === 0 && kv.workerSeries.length === 1;
  const displayValue = (value: number, capacity: number | null): number =>
    percentMode && capacity !== null ? +((value / capacity) * 100).toFixed(1) : value;
  const peakPercent = percentMode
    ? Math.max(
        0,
        ...displayedSeries.flatMap((series) =>
          series.active.map((value) => displayValue(value, series.capacity)),
        ),
      )
    : 0;
  // Keep 100% as the normal visual baseline, but preserve over-capacity
  // samples as a diagnostic signal instead of clipping them at the ceiling.
  const percentAxisMax = Math.max(100, Math.ceil((peakPercent * 1.05) / 5) * 5);
  return {
    ...opt,
    xAxis: { ...(opt.xAxis as object), name: 's', nameTextStyle: { color: t.sub, fontSize: 10 } },
    yAxis: {
      ...(opt.yAxis as object),
      ...(percentMode ? { max: percentAxisMax } : {}),
      name: percentMode ? 'KV %' : 'KV tokens',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      ...kv.workerSeries.map((series) => {
        const color = colorFor(series.worker.poolTag);
        const label =
          series.label.startsWith(`${series.worker.poolTag}/`) ||
          series.label.startsWith(`${series.worker.poolTag} ·`)
            ? series.label
            : `${series.worker.poolTag} · ${series.label}`;
        return {
          name: safeChartText(label),
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: series.active.map((value, index) => [
            x[index],
            displayValue(value, series.capacity),
          ]),
          color,
          lineStyle: {
            width: selectedWorkerOnly ? 3.4 : 1.1,
            color,
            opacity: selectedWorkerOnly ? 1 : 0.42,
          },
          emphasis: {
            focus: 'series' as const,
            lineStyle: { width: selectedWorkerOnly ? 4.2 : 2.1, opacity: 1 },
          },
          z: selectedWorkerOnly ? 4 : 2,
        };
      }),
      ...kv.series.map((series) => {
        const color = colorFor(series.poolTag ?? series.key);
        const label =
          series.poolTag === undefined ||
          series.label.toLowerCase() === series.poolTag.toLowerCase()
            ? series.label
            : `${series.poolTag} · ${series.label}`;
        return {
          name: safeChartText(`${label} average`),
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: series.active.map((value, index) => [
            x[index],
            displayValue(value, series.capacity),
          ]),
          color,
          lineStyle: { width: 3.4, color, opacity: 1 },
          z: 4,
        };
      }),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}

// ---- scheduler backpressure (cluster / pool / worker scope) ----------------
export function pendingQueueOption(
  queue: ScopedPendingQueue,
  t: ChartTheme,
  cursorS?: number,
): EChartsOption {
  const x = queue.t_ms.map((value) => (value / 1000).toFixed(2));
  const cursorCategory =
    cursorS == null || !queue.t_ms.length
      ? null
      : x[
          queue.t_ms.reduce(
            (bestIndex, value, index) =>
              Math.abs(value / 1000 - cursorS) < Math.abs(queue.t_ms[bestIndex] / 1000 - cursorS)
                ? index
                : bestIndex,
            0,
          )
        ];
  const opt = baseChartOption(t);
  const safeTotalLabel = safeChartText(queue.totalLabel);
  return {
    ...opt,
    tooltip: richTextTooltip(t, 'axis', {
      formatter: (params: unknown) => {
        const rows = params as Array<{
          axisValue: string;
          seriesName: string;
          value: number;
        }>;
        const seconds = rows[0]?.axisValue ?? '0';
        const orderedRows = [...rows].sort(
          (a, b) =>
            Number(b.seriesName === safeTotalLabel) - Number(a.seriesName === safeTotalLabel),
        );
        return tooltipLines([
          `${Number(seconds).toFixed(2)}s`,
          ...orderedRows.map((row) => `${row.seriesName}: ${Math.round(row.value)} pending`),
        ]);
      },
    }),
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: chartAxisLine(t),
      axisTick: { show: false },
      axisLabel: {
        color: t.sub,
        fontSize: 11,
        formatter: (value: string) => `${+Number(value).toFixed(1)}`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      ...(opt.yAxis as object),
      min: 0,
      minInterval: 1,
      name: 'pending req',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      ...queue.series.map((series, index) => {
        const componentPalette = [t.palette[0], t.palette[2], t.palette[3], t.palette[4]];
        const color = queue.stacked
          ? componentPalette[index % componentPalette.length]
          : t.palette[1];
        return {
          name: safeChartText(series.label),
          type: 'line' as const,
          step: 'end' as const,
          stack: queue.stacked ? 'pending-workers' : undefined,
          symbol: 'none',
          data: series.pending,
          lineStyle: {
            width: queue.stacked ? 1.2 : 2.6,
            color,
            opacity: queue.stacked ? 0.9 : 1,
          },
          areaStyle: { opacity: queue.stacked ? 0.58 : 0.13, color },
          emphasis: { focus: 'series' as const },
          z: 2,
        };
      }),
      ...(queue.stacked
        ? [
            {
              name: safeTotalLabel,
              type: 'line' as const,
              step: 'end' as const,
              symbol: 'none',
              data: queue.total,
              lineStyle: { width: 2.6, color: t.palette[1] },
              z: 4,
            },
          ]
        : []),
      ...(cursorCategory != null
        ? [
            {
              type: 'line' as const,
              data: [] as number[],
              silent: true,
              showSymbol: false,
              animation: false,
              markLine: {
                silent: true,
                symbol: ['none', 'none'] as [string, string],
                lineStyle: { color: tokens.terra, width: 1.5, opacity: 0.85 },
                label: {
                  formatter: 'iter',
                  color: tokens.terra,
                  fontSize: 9,
                  position: 'start' as const,
                },
                data: [{ xAxis: cursorCategory }],
              },
            },
          ]
        : []),
    ],
  };
}

export type BatchMetric = 'total_tokens' | 'prefill_tokens' | 'decode_requests';

function batchMetricView(batch: BatchSeries, metric: BatchMetric) {
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

/** One worker batch signal per chart. Keeping these as separate options avoids
 * implying that routed FFN totals have a prefill/decode additive decomposition. */
export function batchMetricOption(
  batch: BatchSeries,
  metric: BatchMetric,
  t: ChartTheme,
  cursorS?: number,
): EChartsOption {
  const x = batch.t_ms.map((value) => +(value / 1000).toFixed(3));
  const metricView = batchMetricView(batch, metric);
  const opt = baseChartOption(t);
  return {
    ...opt,
    tooltip: richTextTooltip(t, 'axis', {
      valueFormatter: (value) => `${Number(value).toLocaleString('en-US')} ${metricView.unit}`,
    }),
    xAxis: {
      ...(opt.xAxis as object),
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    yAxis: {
      ...(opt.yAxis as object),
      min: 0,
      name: metricView.unit,
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      {
        name: metricView.name,
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        data: metricView.values.map((value, index) => [x[index], value]),
        lineStyle: { width: 2.6, color: t.palette[0], opacity: 1 },
        areaStyle: { color: t.palette[0], opacity: 0.12 },
        z: 3,
      },
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}

/** Pool snapshot chart: the aggregate and per-worker average share one axis,
 * making the scale difference explicit without mixing asynchronous invocations. */
export function poolBatchMetricOption(
  aggregate: BatchSeries,
  average: BatchSeries,
  metric: BatchMetric,
  t: ChartTheme,
  cursorS?: number,
): EChartsOption {
  const x = aggregate.t_ms.map((value) => +(value / 1000).toFixed(3));
  const aggregateView = batchMetricView(aggregate, metric);
  const averageView = batchMetricView(average, metric);
  const opt = baseChartOption(t);
  return {
    ...opt,
    legend: {
      top: 0,
      right: 0,
      data: ['pool aggregate', 'pool average'],
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: chartGrid({ left: 62, right: 18, top: 34, bottom: 30 }),
    tooltip: richTextTooltip(t, 'axis', {
      valueFormatter: (value) =>
        `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${aggregateView.unit}`,
    }),
    xAxis: {
      ...(opt.xAxis as object),
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    yAxis: {
      ...(opt.yAxis as object),
      min: 0,
      name: aggregateView.unit.replace(' / invocation', ''),
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      {
        name: 'pool aggregate',
        type: 'line' as const,
        step: 'end' as const,
        symbol: 'none',
        data: aggregateView.values.map((value, index) => [x[index], value]),
        lineStyle: { width: 2.8, color: t.palette[0], opacity: 1 },
        z: 4,
      },
      {
        name: 'pool average',
        type: 'line' as const,
        step: 'end' as const,
        symbol: 'none',
        data: averageView.values.map((value, index) => [x[index], value]),
        lineStyle: { width: 2, color: t.palette[2], type: 'dashed' as const, opacity: 0.95 },
        z: 3,
      },
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}
