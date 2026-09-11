import { describe, expect, it } from 'vitest';

import type { LatencyMarkers, LatencySeries } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import { sloMetricOption } from './option';

const metric: LatencySeries & { markers: LatencyMarkers } = {
  key: 'tpot',
  label: 'TPOT',
  unit: 'ms/token',
  count: 3,
  markers: { p50: 4.1, p90: 4.35, p99: 4.4 },
  x: [3.8, 4.1, 4.4],
  yPct: [33.33, 66.67, 100],
};

describe('sloMetricOption', () => {
  it('keeps the accepted latency CDF option from the same samples', () => {
    const current = sloMetricOption(metric, CHART_THEME, CHART_THEME.palette[1]);
    const currentTooltip = current.tooltip as { formatter: (params: unknown) => string };
    expect(current).toMatchSnapshot();
    const point = [{ value: [4.123456, 92.31] }];
    expect(currentTooltip.formatter(point)).toMatchSnapshot();
  });
});
