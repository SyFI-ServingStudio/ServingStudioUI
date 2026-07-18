import type { LegendComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { RequestState } from '../../domain/run';
import { makeWorkerRef } from '../../domain/worker';
import { poolRequestStateOption } from './poolRequestStateOption';

const requestState: RequestState = {
  tStartMs: [0, 5_000],
  tEndMs: [5_000, 10_000],
  clusterSeries: [],
  pools: [
    {
      poolTag: 'attn',
      workerCount: 2,
      totalPending: [5, 7],
      averagePending: [2.5, 3.5],
      workers: [
        {
          worker: makeWorkerRef('attn', 0),
          pending: [2, 3],
          series: [{ category: 'pending', values: [2, 3] }],
        },
        {
          worker: makeWorkerRef('attn', 1),
          pending: [3, 4],
          series: [{ category: 'pending', values: [3, 4] }],
        },
      ],
    },
  ],
};

describe('poolRequestStateOption', () => {
  it('renders pool aggregate, worker average, and every worker independently', () => {
    const option = poolRequestStateOption(requestState, requestState.pools[0], CHART_THEME);
    const legend = option.legend as LegendComponentOption;
    const series = option.series as Array<{ name?: string; data?: number[]; stack?: string }>;

    expect(legend.selectedMode).toBe('multiple');
    expect(series.map((item) => item.name)).toEqual([
      'pool aggregate',
      'worker average',
      'worker 0',
      'worker 1',
    ]);
    expect(series.map((item) => item.data)).toEqual([
      [5, 7, 7],
      [2.5, 3.5, 3.5],
      [2, 3, 3],
      [3, 4, 4],
    ]);
    expect(series.every((item) => item.stack === undefined)).toBe(true);
  });
});
