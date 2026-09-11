import { describe, expect, it } from 'vitest';

import type { RunConcurrency } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import { tokens, withAlpha } from '../../ui/theme';
import { concurrencySparkOption } from './option';

const concurrency: RunConcurrency = {
  tMs: [500, 1_000],
  active: [1.25, 2.5],
  peak: 4,
  sourceLogDir: 'logs/test-run',
  requestCount: 7,
  spanMs: 1_000,
  bins: 2,
  maxPoints: 512,
  aggregation: 'equal-width time-weighted mean',
  definitions: { scope: 'run', active: 'active', tMs: 'time', peak: 'peak', binning: 'bins' },
};

describe('concurrencySparkOption', () => {
  it('reproduces the old hidden-axis sparkline and area fill', () => {
    expect(concurrencySparkOption(concurrency, CHART_THEME)).toMatchObject({
      grid: { left: 0, right: 0, top: 8, bottom: 2 },
      xAxis: { type: 'value', show: false, min: 0, max: 1 },
      yAxis: { type: 'value', show: false, min: 0, max: 5 },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'none',
          silent: true,
          data: [
            [0.5, 1.25],
            [1, 2.5],
          ],
          lineStyle: { width: 1.6, color: CHART_THEME.palette[0], opacity: 0.6 },
          areaStyle: { color: withAlpha(tokens.teal, 0.13) },
        },
      ],
    });
  });
});
