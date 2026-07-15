import type { TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { TraceOverviewData } from './model';
import { arrivalPatternOption, lengthDistributionOption } from './overviewOptions';

const trace: TraceOverviewData = {
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
});
