/*
 * options.ts — ECharts option builders (ported from shared/charts.js).
 * Each returns an EChartsOption consumed by <EChart option={...} />.
 */
import type { EChartsOption } from 'echarts';
import type {
  BatchSeries,
  Slo,
  Throughput,
  UtilSeries,
  KvSeries,
  Concurrency,
} from '../domain/run';
import type { KernelPerf, InputDist } from '../data/kernel';
import type { Imbalance } from '../data/imbalance';
import type { ReadyKernelTimeBreakdown } from '../data/kernelTimeBreakdown';
import { KERNEL_TIME_EPSILON_MS } from '../domain/kernelTimeShare';
import type { ScopedPendingQueue } from '../application/runSelection';
import { tokens } from '../theme';

export interface ChartTheme {
  font: string;
  text: string;
  sub: string;
  axis: string;
  split: string;
  bg: string;
  tip: string;
  palette: string[];
}

export const CHART_THEME: ChartTheme = {
  font: tokens.body,
  text: tokens.ink,
  sub: tokens.sub,
  axis: '#d9cfbb',
  split: 'rgba(120,110,90,.15)',
  bg: tokens.tile,
  tip: 'rgba(42,38,34,.94)',
  palette: [tokens.teal, tokens.terra, tokens.gold, tokens.olive, tokens.violet],
};

// vertical marker at the selected iteration's time (seconds) — dropped into any
// time-axis chart's series list
function cursorMarker(cursorS: number) {
  return {
    type: 'line' as const,
    data: [] as number[][],
    silent: true,
    showSymbol: false,
    animation: false,
    markLine: {
      silent: true,
      symbol: ['none', 'none'] as [string, string],
      lineStyle: { color: tokens.terra, width: 1.5, opacity: 0.85 },
      label: { formatter: 'iter', color: tokens.terra, fontSize: 9, position: 'start' as const },
      data: [{ xAxis: +cursorS.toFixed(2) }],
    },
  };
}

function base(t: ChartTheme): EChartsOption {
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 46, right: 16, top: 30, bottom: 30 },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
    },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.sub, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.sub, fontSize: 11 },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
  };
}

export function sloOption(slo: Slo, t: ChartTheme): EChartsOption {
  const keys: (keyof Slo)[] = ['ttft', 'tpot', 'e2e'];
  const series = keys.map((k, i) => {
    const s = slo[k];
    const col = t.palette[i % t.palette.length];
    return {
      name: `${s.label} (${s.unit})`,
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
  const opt = base(t);
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
  const opt = base(t);
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
  const opt = base(t);
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
        name: s.label,
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
  const opt = base(t);
  return {
    ...opt,
    xAxis: { ...(opt.xAxis as object), name: 's', nameTextStyle: { color: t.sub, fontSize: 10 } },
    yAxis: {
      ...(opt.yAxis as object),
      max: 100,
      name: 'KV %',
      nameTextStyle: { color: t.sub, fontSize: 10 },
    },
    series: [
      ...kv.series.map((s, i) => ({
        name: `${s.label} KV`,
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        data: s.active.map((v, j) => [x[j], +((v / s.capacity) * 100).toFixed(1)]),
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
  const opt = base(t);
  return {
    ...opt,
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      formatter: (params: unknown) => {
        const rows = params as Array<{
          axisValue: string;
          marker: string;
          seriesName: string;
          value: number;
        }>;
        const seconds = rows[0]?.axisValue ?? '0';
        const orderedRows = [...rows].sort(
          (a, b) =>
            Number(b.seriesName === queue.totalLabel) - Number(a.seriesName === queue.totalLabel),
        );
        return [
          `<b>${Number(seconds).toFixed(2)}s</b>`,
          ...orderedRows.map(
            (row) => `${row.marker}${row.seriesName}: ${Math.round(row.value)} pending`,
          ),
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { lineStyle: { color: t.axis } },
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
          name: series.label,
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
              name: queue.totalLabel,
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
    grid: { left: 62, right: 66, top: 34, bottom: 30 },
    legend: {
      top: 0,
      right: 0,
      data: ['prefill tokens', 'decode tokens', 'batch total', 'decode requests'],
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      formatter: (params: unknown) => {
        const rows = params as Array<{
          axisValue: string;
          marker: string;
          seriesName: string;
          value: number;
        }>;
        return [
          `<b>${Number(rows[0]?.axisValue ?? 0).toFixed(2)}s</b>`,
          ...rows.map((row) => `${row.marker}${row.seriesName}: ${Math.round(row.value)}`),
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { lineStyle: { color: t.axis } },
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
  const cats = data.rows.map((r) => `${r.label} · ${formatTotal(r.total)}`);
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 156, right: 22, top: 30, bottom: 28 },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      valueFormatter: (v) => `${Number(v).toFixed(1)}%`,
    },
    xAxis: {
      type: 'value',
      max: 100,
      name: '% of CostTree root kernel time',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { lineStyle: { color: t.axis } },
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
      name: f.label,
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

// ---- timeline sparkline backdrop (wall-clock scrubber) ---------------------
export function timelineSparkOption(tp: Throughput, t: ChartTheme): EChartsOption {
  const x = tp.t_end_ms.map((v) => +(v / 1000).toFixed(2));
  return {
    grid: { left: 0, right: 0, top: 6, bottom: 2 },
    xAxis: { type: 'value', show: false, min: 0, max: x[x.length - 1] },
    yAxis: { type: 'value', show: false },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        silent: true,
        data: tp.total.map((v, i) => [x[i], v]),
        lineStyle: { width: 1.5, color: t.palette[0], opacity: 0.5 },
        areaStyle: { color: 'rgba(31,111,107,.10)' },
      },
    ],
  };
}

// ---- active-requests backdrop for the timeline scrubber --------------------
export function concurrencySparkOption(
  c: Concurrency,
  spanMs: number,
  t: ChartTheme,
): EChartsOption {
  const x = c.t_ms.map((v) => +(v / 1000).toFixed(2));
  return {
    grid: { left: 0, right: 0, top: 8, bottom: 2 },
    xAxis: { type: 'value', show: false, min: 0, max: +(spanMs / 1000).toFixed(2) },
    yAxis: { type: 'value', show: false, min: 0, max: Math.ceil(c.peak * 1.14) },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        silent: true,
        data: c.active.map((v, i) => [x[i], v]),
        lineStyle: { width: 1.6, color: t.palette[0], opacity: 0.6 },
        areaStyle: { color: 'rgba(31,111,107,.13)' },
      },
    ],
  };
}

// ---- kernel throughput per position (worker scope) -------------------------
export interface KernelLoc {
  name: string;
  kind: string;
  color: string;
  tflops: number;
  gbps: number;
  computeUtil: number;
  memUtil: number;
  pct: number;
}

export function kernelThroughputOption(locs: KernelLoc[], t: ChartTheme): EChartsOption {
  const cats = locs.map((l) => l.name.split('.').pop()!);
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 112, right: 24, top: 26, bottom: 28 },
    legend: {
      top: 0,
      right: 0,
      data: ['compute %', 'memory BW %'],
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      formatter: (ps: unknown) => {
        const arr = ps as Array<{ dataIndex: number }>;
        const l = locs[arr[0].dataIndex];
        return `<b>${l.name}</b><br/>${l.tflops} TFLOP/s · ${(l.computeUtil * 100).toFixed(0)}% peak<br/>${l.gbps} GB/s · ${(l.memUtil * 100).toFixed(0)}% peak<br/>${l.pct.toFixed(1)}% of iter`;
      },
    },
    xAxis: {
      type: 'value',
      max: 100,
      name: '% of H200 peak',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.sub, fontSize: 11 },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: cats,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 11, fontFamily: t.font },
    },
    series: [
      {
        name: 'compute %',
        type: 'bar',
        data: locs.map((l) => +(l.computeUtil * 100).toFixed(1)),
        itemStyle: { color: t.palette[2], borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 9,
        barGap: '30%',
      },
      {
        name: 'memory BW %',
        type: 'bar',
        data: locs.map((l) => +(l.memUtil * 100).toFixed(1)),
        itemStyle: { color: t.palette[0], borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 9,
      },
    ],
  };
}

// ---- roofline (kernel scope) -----------------------------------------------
export function rooflineOption(perf: KernelPerf, name: string, t: ChartTheme): EChartsOption {
  const peakTf = perf.peakTflops;
  const peakBw = perf.peakGbps; // TFLOP/s, GB/s
  const line: [number, number][] = [];
  for (let ai = 0.25; ai <= 2048; ai *= 1.25) {
    line.push([+ai.toFixed(3), +Math.min(peakTf, (ai * peakBw) / 1000).toFixed(2)]);
  }
  const ridge = (peakTf * 1000) / peakBw; // arithmetic intensity at the knee
  const dot = perf.boundedBy === 'compute' ? t.palette[2] : t.palette[0];
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 56, right: 20, top: 26, bottom: 42 },
    tooltip: {
      trigger: 'item',
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      formatter: () =>
        `<b>${name}</b><br/>${perf.tflops} TFLOP/s<br/>${perf.gbps} GB/s<br/>AI ${perf.intensity} FLOP/byte<br/>${perf.boundedBy}-bound`,
    },
    xAxis: {
      type: 'log',
      name: 'arithmetic intensity · FLOP/byte',
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: t.sub, fontSize: 10 },
      min: 0.25,
      max: 2048,
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.sub, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'log',
      name: 'TFLOP/s',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      min: 1,
      max: Math.ceil(peakTf * 1.2),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.sub, fontSize: 10 },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        data: line,
        showSymbol: false,
        silent: true,
        z: 1,
        lineStyle: { color: t.sub, width: 2 },
        areaStyle: { color: 'rgba(138,128,114,.05)' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: t.axis, type: 'dashed' },
          label: { formatter: 'ridge', color: t.sub, fontSize: 9 },
          data: [{ xAxis: +ridge.toFixed(1) }],
        },
      },
      {
        type: 'scatter',
        symbolSize: 20,
        data: [[perf.intensity, perf.tflops]],
        z: 5,
        itemStyle: {
          color: dot,
          borderColor: '#fff',
          borderWidth: 2,
          shadowBlur: 8,
          shadowColor: 'rgba(0,0,0,.2)',
        },
      },
    ],
  };
}

// ---- parallel-node load imbalance over time (parallel scope) ---------------
// min–max spread band + mean line + straggler (max lane) line. The straggler
// sets the node's wall-time; the gap to the mean is wasted concurrency.
export function imbalanceOverTimeOption(imb: Imbalance, t: ChartTheme): EChartsOption {
  const x = imb.t_ms.map((v) => +(v / 1000).toFixed(2));
  const pt = (arr: number[]) => arr.map((v, i) => [x[i], v]);
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 46, right: 16, top: 30, bottom: 30 },
    legend: {
      top: 0,
      right: 0,
      data: ['straggler', 'mean', 'min–max'],
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      formatter: (ps: unknown) => {
        const i = (ps as Array<{ dataIndex: number }>)[0].dataIndex;
        return `t = ${x[i]}s<br/>straggler · ${imb.maxLoad[i].toFixed(2)}×<br/>mean · ${imb.meanLoad[i].toFixed(2)}×<br/><b>imbalance · +${imb.imbalancePct[i].toFixed(0)}%</b>`;
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.sub, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      name: 'load / lane',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.sub, fontSize: 11 },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
    series: [
      // min..max band via stacked areas (lower invisible, spread filled)
      {
        name: '_min',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        data: pt(imb.minLoad),
        legendHoverLink: false,
      },
      {
        name: 'min–max',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(122,92,255,.15)' },
        data: imb.maxLoad.map((v, i) => [x[i], +(v - imb.minLoad[i]).toFixed(3)]),
      },
      {
        name: 'mean',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: pt(imb.meanLoad),
        lineStyle: { width: 1.4, color: tokens.sub, type: 'dashed' },
      },
      {
        name: 'straggler',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: pt(imb.maxLoad),
        lineStyle: { width: 2.4, color: tokens.terra },
        z: 4,
      },
    ],
  };
}

// ---- input distribution / backend selection (kernel scope) -----------------
export function inputDistOption(dist: InputDist, t: ChartTheme): EChartsOption {
  const palette = [t.palette[0], t.palette[1], t.palette[2], t.palette[3]];
  const series = dist.backends.map((b, bi) => ({
    name: b,
    type: 'scatter' as const,
    data: dist.points.filter((p) => p.backend === bi).map((p) => [p.x, p.y, p.count]),
    symbolSize: (v: number[]) => 6 + Math.sqrt(v[2]) * 1.6,
    itemStyle: {
      color: palette[bi % palette.length],
      opacity: 0.72,
      borderColor: 'rgba(255,255,255,.6)',
      borderWidth: 0.5,
    },
  }));
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 46, right: 18, top: 28, bottom: 42 },
    legend: {
      top: 0,
      right: 0,
      data: dist.backends,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: t.tip,
      borderWidth: 0,
      textStyle: { color: '#fff', fontFamily: t.font, fontSize: 12 },
      formatter: (p: unknown) => {
        const d = p as { data: number[]; seriesName: string };
        return `${dist.feature[0]}: ${d.data[0]}<br/>${dist.feature[1]}: ${d.data[1]}<br/>backend · ${d.seriesName}<br/>${d.data[2]} samples`;
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 1,
      name: dist.feature[0],
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.sub, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      name: dist.feature[1],
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.sub, fontSize: 10 },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
    series,
  };
}
