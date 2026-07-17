import type { TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { TraceOverviewData } from './model';
import { arrivalPatternOption, lengthDistributionOption } from './overviewOptions';

const trace: TraceOverviewData = {
  requestRate: 4,
  tokenLengths: [16],
  inputDensity: [0.8],
  outputDensity: [0.5],
  arrivalSeconds: [0],
  arrivals: [2],
  arrivalTrend: [2],
  peakToMean: 1,
};

describe('trace overview chart options', () => {
  it('uses the shared safe tooltip renderer', () => {
    [
      lengthDistributionOption(trace, CHART_THEME),
      arrivalPatternOption(trace, CHART_THEME),
    ].forEach((option) => {
      const tooltip = option.tooltip as TooltipComponentOption;
      expect(tooltip.renderMode).toBe('richText');
    });
  });

  it('renders arrival counts as one request-rate line over time', () => {
    const option = arrivalPatternOption(
      {
        ...trace,
        arrivalSeconds: [0.25, 0.75, 1.25],
        arrivals: [2, 4, 6],
        arrivalTrend: [3, 4, 5],
      },
      CHART_THEME,
    );
    const series = option.series as Array<{
      name: string;
      type: string;
      data: [number, number][];
    }>;

    expect(option.yAxis).toMatchObject({ name: 'req/s' });
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ name: 'effective request rate', type: 'line' });
    expect(series[0].data).toEqual([
      [0.25, 4],
      [0.75, 8],
      [1.25, 12],
    ]);
  });
});
