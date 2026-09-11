import { describe, expect, it } from 'vitest';

import type { RequestStateTimeline } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import {
  clusterRequestStateOption,
  poolRequestStateOption,
  workerRequestStateOption,
} from './option';
import type { EChartsOption } from 'echarts';

const timeline: RequestStateTimeline = {
  tStartMs: [0, 5_000],
  tEndMs: [5_000, 10_000],
  clusterSeries: [
    { category: 'pending', values: [5, 7] },
    { category: 'active', values: [2, 3] },
    { category: 'done', values: [0, 2] },
  ],
  pools: [
    {
      pool: 0,
      poolTag: 'attn',
      workerCount: 2,
      totalPending: [5, 7],
      averagePending: [2.5, 3.5],
      workers: [
        {
          worker: { poolTag: 'attn', workerId: '0' },
          pending: [2, 3],
          series: [{ category: 'pending', values: [2, 3] }],
        },
        {
          worker: { poolTag: 'attn', workerId: '1' },
          pending: [3, 4],
          series: [{ category: 'pending', values: [3, 4] }],
        },
      ],
    },
  ],
  sourceLogDir: 'logs/example',
  deployment: 'unified',
  requestsTracked: 10,
  transitions: 20,
  window: { spanMs: 10_000, bins: 2, binWidthMs: 5_000 },
  aggregation: 'equal-width time-weighted mean',
  definitions: {},
};

describe('request-state options', () => {
  it('keeps the accepted cluster chart including its cursor', () => {
    expectOption(clusterRequestStateOption(timeline, CHART_THEME, 4.9));
  });

  it('keeps the accepted pool aggregate, average, and worker lines', () => {
    expectOption(poolRequestStateOption(timeline, timeline.pools[0], CHART_THEME));
  });

  it('keeps the accepted selected-worker category stack', () => {
    const categories = timeline.pools[0].workers[0].series;
    expectOption(workerRequestStateOption(timeline, categories, CHART_THEME));
  });
});

function expectOption(actual: EChartsOption): void {
  expect(actual).toMatchSnapshot();
  const rows = [{ axisValue: '5.00', seriesName: 'pending', value: 2 }];
  expect({
    tooltip: formatter(actual, 'tooltip')(rows),
    axis: formatter(actual, 'axis')('5.00'),
  }).toMatchSnapshot();
}

function formatter(option: EChartsOption, kind: 'tooltip' | 'axis'): (value: unknown) => string {
  const value =
    kind === 'tooltip'
      ? (option.tooltip as { formatter?: unknown }).formatter
      : (option.xAxis as { axisLabel?: { formatter?: unknown } }).axisLabel?.formatter;
  if (typeof value !== 'function') throw new Error(`${kind} formatter is missing`);
  return value as (input: unknown) => string;
}
