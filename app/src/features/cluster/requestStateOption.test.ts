import type { LegendComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { RequestState } from '../../domain/run';
import { clusterRequestStateOption } from './requestStateOption';

const requestState: RequestState = {
  tStartMs: [0, 5_000],
  tEndMs: [5_000, 10_000],
  clusterSeries: [
    { category: 'pending', values: [2, 1] },
    { category: 'active', values: [1, 2] },
    { category: 'done', values: [0, 1] },
  ],
  pools: [],
};

describe('clusterRequestStateOption', () => {
  it('builds independently toggleable layers in one dynamic stack', () => {
    const option = clusterRequestStateOption(requestState, CHART_THEME);
    const legend = option.legend as LegendComponentOption;
    const series = option.series as Array<{ name?: string; stack?: string }>;

    expect(legend.selectedMode).toBe('multiple');
    expect(legend.data).toEqual(['pending', 'active', 'done']);
    expect(series.map((item) => item.name)).toEqual(['pending', 'active', 'done']);
    expect(series.every((item) => item.stack === 'request-state-categories')).toBe(true);
  });

  it('uses one category dimension so stacking cannot accumulate numeric time coordinates', () => {
    const option = clusterRequestStateOption(requestState, CHART_THEME);
    const xAxis = option.xAxis as { type?: string; data?: string[] };
    const series = option.series as Array<{ data?: number[] }>;

    expect(xAxis.type).toBe('category');
    expect(xAxis.data).toEqual(['0.00', '5.00', '10.00']);
    expect(series[0].data).toEqual([2, 1, 1]);
  });

  it('extends the last bin to its end boundary', () => {
    const option = clusterRequestStateOption(requestState, CHART_THEME);
    const pending = (option.series as Array<{ name?: string; data: number[] }>).find(
      (series) => series.name === 'pending',
    );

    expect(pending?.data).toEqual([2, 1, 1]);
  });
});
