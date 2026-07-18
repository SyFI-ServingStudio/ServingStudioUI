import type { LegendComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { RequestState } from '../../domain/run';
import { workerRequestStateOption } from './workerRequestStateOption';

const requestState: RequestState = {
  tStartMs: [0, 5_000],
  tEndMs: [5_000, 10_000],
  clusterSeries: [],
  pools: [],
};

describe('workerRequestStateOption', () => {
  it('renders all selected-worker categories as toggleable stacked areas', () => {
    const option = workerRequestStateOption(
      requestState,
      [
        { category: 'pending', values: [2, 4] },
        { category: 'active', values: [1, 2] },
        { category: 'done', values: [0, 1] },
      ],
      CHART_THEME,
    );
    const legend = option.legend as LegendComponentOption;
    const xAxis = option.xAxis as { type?: string; data?: string[] };
    const series = option.series as Array<{
      name?: string;
      data?: number[];
      step?: string;
      stack?: string;
      areaStyle?: object;
    }>;

    expect(legend).toMatchObject({
      data: ['pending', 'active', 'done'],
      selectedMode: 'multiple',
    });
    expect(xAxis).toMatchObject({ type: 'category', data: ['0.00', '5.00', '10.00'] });
    expect(series[0]).toMatchObject({
      name: 'pending',
      data: [2, 4, 4],
      step: 'end',
      stack: 'request-state-categories',
      areaStyle: expect.any(Object),
    });
    expect(series.map((item) => item.name)).toEqual(['pending', 'active', 'done']);
    expect(series.every((item) => item.stack === 'request-state-categories')).toBe(true);
  });
});
