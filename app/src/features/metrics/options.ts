/*
 * options.ts — ECharts option builders (ported from shared/charts.js).
 * Each returns an EChartsOption consumed by <EChart option={...} />.
 */
import type { EChartsOption } from 'echarts';
import type { BatchSeries, Slo, Throughput, UtilSeries, KvSeries } from '../../domain/run';
import type { ReadyKernelTimeBreakdown } from './kernelTimeBreakdown';
import { KERNEL_TIME_EPSILON_MS } from '../../domain/kernelTimeShare';
import type { ScopedPendingQueue } from '../../application/runSelection';
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

export function utilizationOption(
  util: UtilSeries,
  t: ChartTheme,
  cursorS?: number,
): EChartsOption {
  const x = util.t_ms.map((v) => +(v / 1000).toFixed(1));
  const opt = baseChartOption(t);
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
      ...util.series.map((s, i) => ({
        name: safeChartText(s.label),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        data: s.util.map((v, j) => [x[j], +(v * 100).toFixed(1)]),
        lineStyle: { width: 2.2, color: t.palette[i % t.palette.length] },
        areaStyle: { opacity: 0.12, color: t.palette[i % t.palette.length] },
      })),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}

export function kvOption(kv: KvSeries, t: ChartTheme, cursorS?: number): EChartsOption {
  const x = kv.t_ms.map((v) => +(v / 1000).toFixed(1));
  const percentMode = kv.series.every((series) => series.capacity !== null);
  const opt = baseChartOption(t);
  return {
    ...opt,
    xAxis: { ...(opt.xAxis as object), name: 's', nameTextStyle: { color: t.sub, fontSize: 10 } },
    yAxis: {
      ...(opt.yAxis as object),
      ...(percentMode ? { max: 100 } : {}),
      name: percentMode ? 'KV %' : 'KV tokens',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      ...kv.series.map((s, i) => ({
        name: safeChartText(`${s.label} KV`),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        data: s.active.map((v, j) => [
          x[j],
          percentMode && s.capacity !== null ? +((v / s.capacity) * 100).toFixed(1) : v,
        ]),
        lineStyle: { width: 2.2, color: t.palette[(i + 2) % t.palette.length] },
        areaStyle: { opacity: 0.16, color: t.palette[(i + 2) % t.palette.length] },
      })),
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

// ---- batch composition (pool + worker scope) -------------------------------
export function batchOption(bs: BatchSeries, t: ChartTheme, cursorS?: number): EChartsOption {
  const x = bs.t_ms.map((value) => (value / 1000).toFixed(2));
  const decodeTokens = bs.batchTokens.map((total, index) =>
    Math.max(0, total - (bs.prefillTokens[index] ?? 0)),
  );
  const cursorCategory =
    cursorS == null || !bs.t_ms.length
      ? null
      : x[
          bs.t_ms.reduce(
            (bestIndex, value, index) =>
              Math.abs(value / 1000 - cursorS) < Math.abs(bs.t_ms[bestIndex] / 1000 - cursorS)
                ? index
                : bestIndex,
            0,
          )
        ];
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: chartGrid({ left: 62, right: 66, top: 34, bottom: 30 }),
    legend: {
      top: 0,
      right: 0,
      data: ['prefill tokens', 'decode tokens', 'batch total', 'decode requests'],
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: richTextTooltip(t, 'axis', {
      formatter: (params: unknown) => {
        const rows = params as Array<{
          axisValue: string;
          seriesName: string;
          value: number;
        }>;
        return tooltipLines([
          `${Number(rows[0]?.axisValue ?? 0).toFixed(2)}s`,
          ...rows.map((row) => `${row.seriesName}: ${Math.round(row.value)}`),
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
    yAxis: [
      {
        type: 'value',
        min: 0,
        name: 'tokens / iter',
        nameLocation: 'middle',
        nameGap: 46,
        nameTextStyle: { color: t.sub, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.sub, fontSize: 11 },
        splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
      },
      {
        type: 'value',
        min: 0,
        name: 'decode req / iter',
        nameLocation: 'middle',
        nameGap: 42,
        nameTextStyle: { color: t.sub, fontSize: 10 },
        position: 'right',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.sub, fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'prefill tokens',
        type: 'line' as const,
        stack: 'batch-tokens',
        step: 'end' as const,
        symbol: 'none',
        yAxisIndex: 0,
        data: bs.prefillTokens,
        lineStyle: { width: 0.8, color: t.palette[1] },
        areaStyle: { opacity: 0.76, color: t.palette[1] },
        z: 2,
      },
      {
        name: 'decode tokens',
        type: 'line' as const,
        stack: 'batch-tokens',
        step: 'end' as const,
        symbol: 'none',
        yAxisIndex: 0,
        data: decodeTokens,
        lineStyle: { width: 0.8, color: t.palette[0] },
        areaStyle: { opacity: 0.72, color: t.palette[0] },
        z: 2,
      },
      {
        name: 'batch total',
        type: 'line' as const,
        step: 'end' as const,
        symbol: 'none',
        yAxisIndex: 0,
        data: bs.batchTokens,
        lineStyle: { width: 1.5, color: t.text, opacity: 0.72 },
        z: 4,
      },
      {
        name: 'decode requests',
        type: 'line' as const,
        symbol: 'none',
        yAxisIndex: 1,
        data: bs.decodeRequests,
        lineStyle: { width: 1.5, color: t.palette[2], type: 'dashed' as const },
        z: 5,
      },
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

// ---- cluster kernel time breakdown — 100% stacked bar (cluster scope) ------
export function kernelTimeStackOption(
  data: ReadyKernelTimeBreakdown,
  t: ChartTheme,
): EChartsOption {
  const formatTotal = (totalMs: number): string => {
    if (totalMs >= 1_000_000) return `${(totalMs / 1_000_000).toFixed(2)}M ms`;
    if (totalMs >= 1_000) return `${(totalMs / 1_000).toFixed(2)}K ms`;
    return `${totalMs.toFixed(2)} ms`;
  };
  const cats = data.rows.map((r) => safeChartText(`${r.label} · ${formatTotal(r.total)}`));
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: chartGrid({ left: 156, right: 22, top: 30, bottom: 28 }),
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: richTextTooltip(t, 'axis', {
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => `${Number(v).toFixed(1)}%`,
    }),
    xAxis: {
      type: 'value',
      max: 100,
      name: '% of CostTree root kernel time',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: chartAxisLine(t),
      axisLabel: { color: t.sub, fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: cats,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 12, fontFamily: t.font, fontWeight: 600 },
    },
    series: data.families.map((f) => ({
      name: safeChartText(f.label),
      type: 'bar' as const,
      stack: 'kernel',
      data: data.rows.map((r) =>
        r.total > KERNEL_TIME_EPSILON_MS ? ((r.byGroup[f.group] ?? 0) / r.total) * 100 : 0,
      ),
      itemStyle: { color: f.color },
      barMaxWidth: 34,
    })),
  };
}
