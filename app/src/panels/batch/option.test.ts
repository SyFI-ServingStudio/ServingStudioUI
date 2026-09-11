import { describe, expect, it } from 'vitest';

import type { BatchTimelineScope } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import {
  batchChartSeries,
  batchMetricOption,
  poolBatchMetricOption,
  type BatchChartSeries,
} from './option';

const scope: BatchTimelineScope = {
  poolTag: 'attn',
  workerId: '0',
  invocations: 2,
  plottedPoints: 2,
  timeMs: [0, 1_000],
  series: [
    { key: 'batch_tokens', label: 'Batch tokens', values: [8, 12] },
    { key: 'prefill_tokens', label: 'Prefill tokens', values: [4, 6] },
    { key: 'decode_request_count', label: 'Decode requests', values: [2, 3] },
  ],
  averages: { batch_tokens: 10, prefill_tokens: 5, decode_request_count: 2.5 },
};

describe('batch options', () => {
  it('projects all three Analyzer series without changing samples', () => {
    expect(batchChartSeries(scope)).toEqual({
      tMs: [0, 1_000],
      batchTokens: [8, 12],
      prefillTokens: [4, 6],
      decodeRequests: [2, 3],
    });
  });

  it.each(['total_tokens', 'prefill_tokens', 'decode_requests'] as const)(
    'reproduces the old %s single-scope chart',
    (metric) => {
      const series = batchChartSeries(scope);
      expect(batchMetricOption(series, metric, CHART_THEME, 0.5)).toMatchSnapshot();
    },
  );

  it.each(['total_tokens', 'prefill_tokens', 'decode_requests'] as const)(
    'reproduces the old %s pool aggregate and average chart',
    (metric) => {
      const aggregate = batchChartSeries(scope);
      const average: BatchChartSeries = {
        ...aggregate,
        batchTokens: aggregate.batchTokens.map((value) => value / 2),
        prefillTokens: aggregate.prefillTokens.map((value) => value / 2),
        decodeRequests: aggregate.decodeRequests.map((value) => value / 2),
      };
      expect(poolBatchMetricOption(aggregate, average, metric, CHART_THEME, 0.5)).toMatchSnapshot();
    },
  );
});
