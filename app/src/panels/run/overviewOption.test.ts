import type { TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import type { RunWorkload } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import { arrivalPatternOption, lengthDistributionOption } from './overviewOption';

const trace: RunWorkload = {
  sourcePaths: ['trace/test.csv'],
  requestCount: 3,
  averageInputTokens: 16,
  averageOutputTokens: 8,
  arrivalBasis: 'effective_open_loop',
  requestRate: 4,
  tokenLengths: [16],
  inputDensity: [0.8],
  outputDensity: [0.5],
  arrivalSeconds: [0],
  arrivals: [2],
  arrivalTrend: [2],
  peakToMean: 1,
};

describe('run overview chart options', () => {
  it('keeps the mirrored token distribution and safe tooltip renderer', () => {
    const option = lengthDistributionOption(trace, CHART_THEME);
    expect(option.tooltip as TooltipComponentOption).toMatchObject({ renderMode: 'richText' });
    const series = option.series as Array<{ name: string; data: [number, number][] }>;
    expect(series.map((entry) => [entry.name, entry.data])).toEqual([
      ['input lens', [[16, 0.8]]],
      ['output lens', [[16, -0.5]]],
    ]);
  });

  it('converts arrival buckets to the existing request-rate line', () => {
    const option = arrivalPatternOption(
      {
        ...trace,
        arrivalSeconds: [0.25, 0.75, 1.25],
        arrivals: [2, 4, 6],
        arrivalTrend: [3, 4, 5],
      },
      CHART_THEME,
    );
    expect(option.tooltip as TooltipComponentOption).toMatchObject({ renderMode: 'richText' });
    const series = option.series as Array<{ name: string; type: string; data: [number, number][] }>;
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      name: 'effective request rate',
      type: 'line',
      data: [
        [0.25, 4],
        [0.75, 8],
        [1.25, 12],
      ],
    });
  });
});
