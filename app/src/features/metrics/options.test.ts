import type { EChartsOption, TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import type { ScopedPendingQueue } from '../../application/runSelection';
import { CHART_THEME } from '../../charts/platform';
import type { BatchSeries, KvSeries, Slo, Throughput, UtilSeries } from '../../domain/run';
import type { ReadyKernelTimeBreakdown } from './kernelTimeBreakdown';
import {
  batchOption,
  kernelTimeStackOption,
  kvOption,
  pendingQueueOption,
  sloOption,
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
      sloOption(slo, CHART_THEME),
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
      sloOption(slo, CHART_THEME),
      utilizationOption(utilization, CHART_THEME),
      kvOption(kv, CHART_THEME),
      kernelTimeStackOption(breakdown, CHART_THEME),
    ].forEach((option) => {
      const firstSeriesName = (option.series as Array<{ name?: string }>)[0]?.name ?? '';
      expectSafeText(firstSeriesName);
    });

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
});
