import type { EChartsOption, TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import type { ScopedPendingQueue } from '../../application/runSelection';
import { CHART_THEME } from '../../charts/platform';
import type { BatchSeries, KvSeries, Slo, Throughput, UtilSeries } from '../../domain/run';
import type { ReadyKernelTimeBreakdown } from './kernelTimeBreakdown';
import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import {
  batchMetricOption,
  kernelTimeStackOption,
  kvOption,
  pendingQueueOption,
  poolBatchMetricOption,
  sloMetricOption,
  throughputOption,
  utilizationOption,
} from './options';

const ATTACK = '<img src=x onerror=alert(1)>{owned|payload}&';

function tooltipOf(option: EChartsOption): TooltipComponentOption {
  expect(option.tooltip).toBeTruthy();
  expect(Array.isArray(option.tooltip)).toBe(false);
  return option.tooltip as TooltipComponentOption;
}

function expectSafeText(value: string): void {
  expect(value).not.toContain('<img');
  expect(value).not.toContain('{owned|payload}');
  expect(value).not.toMatch(/[<>{}&]/);
}

const throughput: Throughput = {
  t_start_ms: [0],
  t_end_ms: [1000],
  total: [10],
  prefill: [4],
  decode: [6],
};

const slo: Slo = {
  ttft: {
    label: ATTACK,
    unit: 'ms',
    x: [1],
    y_pct: [100],
    markers: { p50: 1, p90: 1, p99: 1 },
  },
  tpot: {
    label: 'TPOT',
    unit: 'ms',
    x: [1],
    y_pct: [100],
    markers: { p50: 1, p90: 1, p99: 1 },
  },
  e2e: {
    label: 'E2E',
    unit: 'ms',
    x: [1],
    y_pct: [100],
    markers: { p50: 1, p90: 1, p99: 1 },
  },
};

const utilization: UtilSeries = {
  t_ms: [0],
  series: [{ key: 'worker', label: ATTACK, util: [0.5] }],
  workerSeries: [],
};

const multiPoolUtilization: UtilSeries = {
  t_ms: [0],
  series: [
    { key: 'pool_0', label: 'Pool 0', poolTag: 'attn', util: [0.5] },
    { key: 'pool_1', label: 'Pool 1', poolTag: 'ffn', util: [0.75] },
  ],
  workerSeries: [
    {
      key: makeWorkerKey('attn', '0'),
      label: 'Worker 0',
      worker: makeWorkerRef('attn', '0'),
      util: [0.4],
    },
    {
      key: makeWorkerKey('ffn', '0'),
      label: 'Worker 0',
      worker: makeWorkerRef('ffn', '0'),
      util: [0.8],
    },
  ],
};

const kv: KvSeries = {
  t_ms: [0],
  series: [{ key: 'worker', label: ATTACK, capacity: 10, active: [5] }],
  workerSeries: [],
};

const multiPoolKv: KvSeries = {
  t_ms: [0],
  series: [
    { key: 'attn/g0', label: 'attn', poolTag: 'attn', capacity: 10, active: [5] },
    { key: 'decode/g0', label: 'decode', poolTag: 'decode', capacity: 20, active: [12] },
  ],
  workerSeries: [
    {
      key: makeWorkerKey('attn', '0'),
      label: 'Worker 0',
      worker: makeWorkerRef('attn', '0'),
      capacity: 10,
      active: [4],
    },
    {
      key: makeWorkerKey('decode', '0'),
      label: 'Worker 0',
      worker: makeWorkerRef('decode', '0'),
      capacity: 20,
      active: [10],
    },
  ],
};

const queue: ScopedPendingQueue = {
  t_ms: [0],
  totalLabel: ATTACK,
  total: [2],
  series: [{ key: 'worker', label: ATTACK, pending: [2] }],
  stacked: true,
};

const batch: BatchSeries = {
  t_ms: [0],
  batchTokens: [8],
  prefillTokens: [4],
  decodeRequests: [2],
};

const breakdown: ReadyKernelTimeBreakdown = {
  status: 'ready',
  families: [{ group: 'gemm', label: ATTACK, color: '#123456' }],
  rows: [{ label: ATTACK, total: 2, byGroup: { gemm: 2 } }],
  kernelTimeTotalsExact: true,
  positionMixExact: true,
  sampling: {
    positionMixExact: true,
    method: 'all rows',
    rawRows: 1,
    sampledRows: 1,
    maxReplayRowsTarget: 1,
  },
};

describe('scope metric chart options', () => {
  it('keeps total, prefill, and decode request batch signals in independent charts', () => {
    const cases = [
      ['total_tokens', 'tokens / invocation', 8],
      ['prefill_tokens', 'tokens / invocation', 4],
      ['decode_requests', 'requests / invocation', 2],
    ] as const;

    for (const [metric, unit, expected] of cases) {
      const option = batchMetricOption(batch, metric, CHART_THEME);
      const series = option.series as Array<{ data: [number, number][] }>;
      expect(option.yAxis).toMatchObject({ name: unit });
      expect(series).toHaveLength(1);
      expect(series[0].data).toEqual([[0, expected]]);
    }
  });

  it('plots pool batch aggregate and average as separate series', () => {
    const average: BatchSeries = {
      t_ms: [0],
      batchTokens: [4],
      prefillTokens: [2],
      decodeRequests: [1],
    };
    const option = poolBatchMetricOption(batch, average, 'total_tokens', CHART_THEME);
    const series = option.series as Array<{ name: string; data: [number, number][] }>;

    expect(series.map((item) => item.name)).toEqual(['pool aggregate', 'pool average']);
    expect(series[0].data).toEqual([[0, 8]]);
    expect(series[1].data).toEqual([[0, 4]]);
  });

  it('uses renderer-native rich-text mode for every popup tooltip', () => {
    const options = [
      sloMetricOption(slo.ttft, CHART_THEME, CHART_THEME.palette[0]),
      sloMetricOption(slo.tpot, CHART_THEME, CHART_THEME.palette[1]),
      sloMetricOption(slo.e2e, CHART_THEME, CHART_THEME.palette[2]),
      throughputOption(throughput, CHART_THEME),
      utilizationOption(utilization, CHART_THEME),
      kvOption(kv, CHART_THEME),
      pendingQueueOption(queue, CHART_THEME),
      kernelTimeStackOption(breakdown, CHART_THEME),
    ];

    options.forEach((option) => expect(tooltipOf(option).renderMode).toBe('richText'));
  });

  it('sanitizes analyzer identities in series and category labels', () => {
    [
      sloMetricOption(slo.ttft, CHART_THEME, CHART_THEME.palette[0]),
      utilizationOption(utilization, CHART_THEME),
      kvOption(kv, CHART_THEME),
      kernelTimeStackOption(breakdown, CHART_THEME),
    ].forEach((option) => {
      const firstSeriesName = (option.series as Array<{ name?: string }>)[0]?.name ?? '';
      expectSafeText(firstSeriesName);
    });

    expect(
      (sloMetricOption(slo.ttft, CHART_THEME, CHART_THEME.palette[0]).series as unknown[]).length,
    ).toBe(1);

    const stackChart = kernelTimeStackOption(breakdown, CHART_THEME);
    const categoryAxis = stackChart.yAxis as { data?: string[] };
    expectSafeText(categoryAxis.data?.[0] ?? '');
  });

  it('sanitizes pending-queue custom tooltip rows', () => {
    const chart = pendingQueueOption(queue, CHART_THEME);
    const series = chart.series as Array<{ name?: string }>;
    const formatter = tooltipOf(chart).formatter;
    expect(typeof formatter).toBe('function');
    const rendered = String(
      (formatter as (value: unknown) => unknown)(
        series.slice(0, 2).map((item) => ({
          axisValue: '0',
          seriesName: item.name ?? '',
          value: 2,
        })),
      ),
    );
    expectSafeText(rendered);
  });

  it('lets each SLO log axis derive its limits from its own latency data', () => {
    const option = sloMetricOption(slo.ttft, CHART_THEME, CHART_THEME.palette[0]);
    const xAxis = option.xAxis as { min?: number; max?: number; type?: string };

    expect(xAxis.type).toBe('log');
    expect(xAxis).not.toHaveProperty('min');
    expect(xAxis).not.toHaveProperty('max');
  });

  it('keeps the throughput x-axis title and final tick inside the SVG viewport', () => {
    const option = throughputOption(throughput, CHART_THEME);
    expect(option.grid).toMatchObject({ containLabel: true });
    expect(option.xAxis).toMatchObject({
      name: 'wall-clock · s',
      nameLocation: 'middle',
      nameGap: 24,
    });
  });

  it('renders throughput intervals as unstacked steps within the real time range', () => {
    const intervalThroughput: Throughput = {
      t_start_ms: [0, 1_000_000],
      t_end_ms: [1_000_000, 2_000_000],
      total: [10, 20],
      prefill: [4, 12],
      decode: [6, 8],
    };
    const option = throughputOption(intervalThroughput, CHART_THEME);
    const series = option.series as Array<{
      name: string;
      stack?: string;
      step?: string;
      areaStyle?: unknown;
      lineStyle: { width: number };
      data: [number, number][];
    }>;

    expect(option.xAxis).toMatchObject({ min: 0, max: 2000 });
    expect(series.map((item) => item.name)).toEqual(['total', 'prefill', 'decode']);
    expect(series.every((item) => item.stack === undefined && item.areaStyle === undefined)).toBe(
      true,
    );
    expect(series.every((item) => item.step === 'end')).toBe(true);
    expect(series.every((item) => item.data.at(-1)?.[0] === 2000)).toBe(true);
    expect(series[0].lineStyle.width).toBeGreaterThan(series[1].lineStyle.width);
  });

  it('renders worker utilization with identity-stable pool colors and bold pool averages', () => {
    const option = utilizationOption(multiPoolUtilization, CHART_THEME);
    const reordered = utilizationOption(
      { ...multiPoolUtilization, series: [...multiPoolUtilization.series].reverse() },
      CHART_THEME,
    );
    const series = option.series as Array<{
      name: string;
      lineStyle: { color: string; width: number; opacity: number };
      z: number;
    }>;
    const reorderedSeries = reordered.series as Array<{
      name: string;
      lineStyle: { color: string };
    }>;
    const colors = new Map(series.map((item) => [item.name, item.lineStyle.color]));
    const reorderedColors = new Map(
      reorderedSeries.map((item) => [item.name, item.lineStyle.color]),
    );

    expect(series.map((item) => item.name)).toEqual([
      'attn · Worker 0',
      'ffn · Worker 0',
      'attn · Pool 0 average',
      'ffn · Pool 1 average',
    ]);
    expect(reorderedColors).toEqual(colors);
    expect(new Set(colors.values()).size).toBe(2);
    expect(series.slice(0, 2).every((item) => item.lineStyle.width === 1.1 && item.z === 2)).toBe(
      true,
    );
    expect(series.slice(2).every((item) => item.lineStyle.width === 3.4 && item.z === 4)).toBe(
      true,
    );
    expect(option.legend).toBeTruthy();
  });

  it('renders worker KV occupancy with identity-stable pool colors and bold pool averages', () => {
    const option = kvOption(multiPoolKv, CHART_THEME);
    const reordered = kvOption(
      { ...multiPoolKv, series: [...multiPoolKv.series].reverse() },
      CHART_THEME,
    );
    const series = option.series as Array<{
      name: string;
      color: string;
      lineStyle: { color: string; width: number };
      z: number;
    }>;
    const reorderedSeries = reordered.series as Array<{
      name: string;
      lineStyle: { color: string };
    }>;
    const colors = new Map(series.map((item) => [item.name, item.lineStyle.color]));
    const reorderedColors = new Map(
      reorderedSeries.map((item) => [item.name, item.lineStyle.color]),
    );

    expect(series.map((item) => item.name)).toEqual([
      'attn · Worker 0',
      'decode · Worker 0',
      'attn average',
      'decode average',
    ]);
    expect(reorderedColors).toEqual(colors);
    expect(new Set(colors.values()).size).toBe(2);
    expect(series.every((item) => item.color === item.lineStyle.color)).toBe(true);
    expect(series.slice(0, 2).every((item) => item.lineStyle.width === 1.1 && item.z === 2)).toBe(
      true,
    );
    expect(series.slice(2).every((item) => item.lineStyle.width === 3.4 && item.z === 4)).toBe(
      true,
    );
  });

  it('expands the KV percent axis above 100 instead of clipping over-capacity samples', () => {
    const option = kvOption(
      {
        t_ms: [0, 1000],
        series: [],
        workerSeries: [
          {
            key: makeWorkerKey('attn', '0'),
            label: 'Worker 0',
            worker: makeWorkerRef('attn', '0'),
            capacity: 100,
            active: [98, 103],
          },
        ],
      },
      CHART_THEME,
    );
    const yAxis = option.yAxis as { max?: number };
    const series = option.series as Array<{ data: [number, number][] }>;

    expect(yAxis.max).toBeGreaterThan(103);
    expect(series[0].data.at(-1)?.[1]).toBe(103);
  });

  it('promotes a selected worker utilization and KV series to a solid primary line', () => {
    const workerUtilization = utilizationOption(
      { ...multiPoolUtilization, series: [], workerSeries: [multiPoolUtilization.workerSeries[0]] },
      CHART_THEME,
    );
    const workerKv = kvOption(
      { ...multiPoolKv, series: [], workerSeries: [multiPoolKv.workerSeries[0]] },
      CHART_THEME,
    );
    const utilizationLine = (
      workerUtilization.series as Array<{
        lineStyle: { width: number; opacity: number };
        z: number;
      }>
    )[0];
    const kvLine = (
      workerKv.series as Array<{
        lineStyle: { width: number; opacity: number };
        z: number;
      }>
    )[0];

    expect(utilizationLine).toMatchObject({ lineStyle: { width: 3.4, opacity: 1 }, z: 4 });
    expect(kvLine).toMatchObject({ lineStyle: { width: 3.4, opacity: 1 }, z: 4 });
  });
});
