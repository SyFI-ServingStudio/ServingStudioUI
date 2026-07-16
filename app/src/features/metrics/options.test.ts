import type { EChartsOption, TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import type { ScopedPendingQueue } from '../../application/runSelection';
import { CHART_THEME } from '../../charts/platform';
import type { BatchSeries, KvSeries, Slo, Throughput, UtilSeries } from '../../domain/run';
import type { ReadyKernelTimeBreakdown } from './kernelTimeBreakdown';
import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import {
  batchOption,
  kernelTimeStackOption,
  kvOption,
  pendingQueueOption,
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
  it('uses renderer-native rich-text mode for every popup tooltip', () => {
    const options = [
      sloMetricOption(slo.ttft, CHART_THEME, CHART_THEME.palette[0]),
      sloMetricOption(slo.tpot, CHART_THEME, CHART_THEME.palette[1]),
      sloMetricOption(slo.e2e, CHART_THEME, CHART_THEME.palette[2]),
      throughputOption(throughput, CHART_THEME),
      utilizationOption(utilization, CHART_THEME),
      kvOption(kv, CHART_THEME),
      pendingQueueOption(queue, CHART_THEME),
      batchOption(batch, CHART_THEME),
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

  it('keeps the throughput x-axis title and final tick inside the SVG viewport', () => {
    const option = throughputOption(throughput, CHART_THEME);
    expect(option.grid).toMatchObject({ containLabel: true });
    expect(option.xAxis).toMatchObject({
      name: 'wall-clock · s',
      nameLocation: 'middle',
      nameGap: 24,
    });
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
    expect(series.slice(2).every((item) => item.lineStyle.width === 3.4 && item.z === 4)).toBe(true);
    expect(option.legend).toBeTruthy();
  });
});
