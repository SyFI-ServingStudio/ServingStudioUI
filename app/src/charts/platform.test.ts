import type { EChartsOption, TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import type { ScopedPendingQueue } from '../application/runSelection';
import type { Imbalance } from '../data/imbalance';
import type { InputDist, KernelPerf } from '../data/kernel';
import type { ReadyKernelTimeBreakdown } from '../data/kernelTimeBreakdown';
import type { BatchSeries, KvSeries, Slo, Throughput, UtilSeries } from '../domain/run';
import {
  arrivalPatternOption,
  lengthDistributionOption,
  type TraceOverviewData,
} from '../features/run-overview';
import {
  batchOption,
  imbalanceOverTimeOption,
  inputDistOption,
  kernelThroughputOption,
  kernelTimeStackOption,
  kvOption,
  pendingQueueOption,
  rooflineOption,
  sloOption,
  throughputOption,
  utilizationOption,
} from './options';
import { CHART_THEME, safeChartText } from './platform';

const ATTACK = '<img src=x onerror=alert(1)>{owned|payload}&';

function tooltipOf(option: EChartsOption): TooltipComponentOption {
  expect(option.tooltip).toBeTruthy();
  expect(Array.isArray(option.tooltip)).toBe(false);
  return option.tooltip as TooltipComponentOption;
}

function formatTooltip(option: EChartsOption, params: unknown): string {
  const formatter = tooltipOf(option).formatter;
  expect(typeof formatter).toBe('function');
  return String((formatter as (value: unknown) => unknown)(params));
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

const locations = [
  {
    name: `decoder.${ATTACK}`,
    kind: 'single_gemm',
    color: '#123456',
    tflops: 500,
    gbps: 2000,
    computeUtil: 0.5,
    memUtil: 0.4,
    pct: 10,
  },
];

const perf: KernelPerf = {
  tflops: 500,
  gbps: 2000,
  peakTflops: 1000,
  peakGbps: 4000,
  computeUtil: 0.5,
  memUtil: 0.5,
  boundedBy: 'compute',
  intensity: 250,
};

const imbalance: Imbalance = {
  label: 'two lanes',
  dim: 'rank',
  lanes: 2,
  overlap: 1,
  nodeMs: 1,
  t_ms: [0],
  maxLoad: [1.2],
  meanLoad: [1],
  minLoad: [0.8],
  imbalancePct: [20],
  perLaneAvg: [0.8, 1.2],
  laneLabels: ['r0', 'r1'],
  stragglerLane: 1,
  stragglerFactor: 1.2,
  maxImbalancePct: 20,
  avgImbalancePct: 20,
  stragglerLeafId: 1,
  stragglerName: 'kernel',
};

const distribution: InputDist = {
  backends: [ATTACK],
  feature: [ATTACK, ATTACK],
  projection: 'raw',
  points: [{ x: 0.2, y: 0.3, backend: 0, count: 4 }],
};

const trace: TraceOverviewData = {
  tokenLengths: [16],
  inputDensity: [0.8],
  outputDensity: [0.5],
  arrivalSeconds: [0],
  arrivals: [2],
  arrivalTrend: [2],
  peakToMean: 1,
};

describe('chart platform', () => {
  it('neutralizes HTML and zrender rich-text grammar in external labels', () => {
    const safe = safeChartText(ATTACK);

    expectSafeText(safe);
    expect(safe).toContain('＜img');
    expect(safe).toContain('｛owned|payload｝');
  });

  it('uses canvas rich-text mode for every chart with a popup tooltip', () => {
    const options = [
      sloOption(slo, CHART_THEME),
      throughputOption(throughput, CHART_THEME),
      utilizationOption(utilization, CHART_THEME),
      kvOption(kv, CHART_THEME),
      pendingQueueOption(queue, CHART_THEME),
      batchOption(batch, CHART_THEME),
      kernelTimeStackOption(breakdown, CHART_THEME),
      kernelThroughputOption(locations, CHART_THEME),
      rooflineOption(perf, ATTACK, CHART_THEME),
      imbalanceOverTimeOption(imbalance, CHART_THEME),
      inputDistOption(distribution, CHART_THEME),
      lengthDistributionOption(trace, CHART_THEME),
      arrivalPatternOption(trace, CHART_THEME),
    ];

    options.forEach((option) => expect(tooltipOf(option).renderMode).toBe('richText'));
  });

  it('keeps analyzer identities out of custom tooltip markup', () => {
    const throughputChart = kernelThroughputOption(locations, CHART_THEME);
    const throughputText = formatTooltip(throughputChart, [{ dataIndex: 0 }]);
    expectSafeText(throughputText);

    const rooflineText = formatTooltip(rooflineOption(perf, ATTACK, CHART_THEME), {});
    expectSafeText(rooflineText);

    const inputChart = inputDistOption(distribution, CHART_THEME);
    const inputSeries = (inputChart.series as Array<{ name: string }>)[0];
    const inputText = formatTooltip(inputChart, {
      data: [0.2, 0.3, 4],
      seriesName: inputSeries.name,
    });
    expectSafeText(inputText);

    const queueChart = pendingQueueOption(queue, CHART_THEME);
    const queueSeries = queueChart.series as Array<{ name?: string }>;
    const queueText = formatTooltip(
      queueChart,
      queueSeries.slice(0, 2).map((series) => ({
        axisValue: '0',
        seriesName: series.name ?? '',
        value: 2,
      })),
    );
    expectSafeText(queueText);
  });

  it('sanitizes identities used by built-in tooltip, legend, and axes', () => {
    const namedCharts = [
      sloOption(slo, CHART_THEME),
      utilizationOption(utilization, CHART_THEME),
      kvOption(kv, CHART_THEME),
      kernelTimeStackOption(breakdown, CHART_THEME),
    ];
    namedCharts.forEach((option) => {
      const firstSeriesName = (option.series as Array<{ name?: string }>)[0]?.name ?? '';
      expectSafeText(firstSeriesName);
    });

    const inputChart = inputDistOption(distribution, CHART_THEME);
    const xAxis = inputChart.xAxis as { name?: string };
    const yAxis = inputChart.yAxis as { name?: string };
    expectSafeText(xAxis.name ?? '');
    expectSafeText(yAxis.name ?? '');

    const stackChart = kernelTimeStackOption(breakdown, CHART_THEME);
    const categoryAxis = stackChart.yAxis as { data?: string[] };
    expectSafeText(categoryAxis.data?.[0] ?? '');
  });
});
