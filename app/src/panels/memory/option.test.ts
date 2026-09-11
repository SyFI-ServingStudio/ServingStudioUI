import { describe, expect, it } from 'vitest';

import kvSeriesJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/kv_occupancy_series.json';
import { parseKvOccupancySeries } from '../../artifacts/schema/kvOccupancy';
import { CHART_THEME } from '../../ui/charts/platform';
import { kvOption } from './option';

describe('kvOption', () => {
  it('keeps the accepted option from the Analyzer payload', () => {
    const timeline = parseKvOccupancySeries(kvSeriesJson);
    expect(kvOption(timeline, CHART_THEME, 12.5)).toMatchSnapshot();
  });

  it('keeps every worker shadow line and every pool average', () => {
    const timeline = parseKvOccupancySeries(kvSeriesJson);
    const option = kvOption(timeline, CHART_THEME);

    expect(option.series).toHaveLength(timeline.workerSeries.length + timeline.series.length);
  });
});
