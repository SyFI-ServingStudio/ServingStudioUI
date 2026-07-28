import { describe, expect, it } from 'vitest';

import type { SweepAnalysis } from '../../domain/sweep';
import { formatMetricValue, sweepChartOption, sweepFacets } from './sweepOption';

const analysis: SweepAnalysis = {
  protocolVersion: 1,
  schemaVersion: 1,
  workspaceId: 'w_main',
  sweepId: 's_test',
  displayName: 'test sweep',
  axes: ['request_rate', 'tensor_parallel', 'dtype'],
  domains: {
    request_rate: [10, 20],
    tensor_parallel: [1, 2],
    dtype: ['bf16', 'fp8'],
  },
  metrics: [
    {
      key: 'gpu_utilization',
      label: 'GPU utilization',
      group: 'util',
      unit: '%',
      objective: 'maximize',
    },
  ],
  runs: [
    {
      runId: 'r_1',
      coordinates: { request_rate: 10, tensor_parallel: 1, dtype: 'bf16' },
      labels: {},
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { gpu_utilization: 0.94 },
    },
    {
      runId: 'r_2',
      coordinates: { request_rate: 20, tensor_parallel: 2, dtype: 'fp8' },
      labels: {},
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { gpu_utilization: 0.97 },
    },
  ],
  definitions: {},
};

describe('sweep aggregate options', () => {
  it('uses axes after the first two as stable facets', () => {
    expect(sweepFacets(analysis).map((facet) => facet.label)).toEqual(['dtype bf16', 'dtype fp8']);
  });

  it('converts utilization fractions only at display time', () => {
    const facet = sweepFacets(analysis)[0];
    const option = sweepChartOption(
      analysis,
      analysis.metrics[0],
      facet,
      'request_rate:10|tensor_parallel:1|dtype:"bf16"',
    );
    const series = Array.isArray(option.series) ? option.series : [option.series];
    expect(option.tooltip).toEqual({ show: false });
    expect(series[0]).toMatchObject({
      type: 'heatmap',
      data: [
        expect.objectContaining({
          value: [0, 0, 94],
          runId: 'r_1',
        }),
      ],
    });
    expect(series[1]).toMatchObject({
      type: 'custom',
      silent: true,
      z: 20,
      data: [[0, 0]],
    });
    expect(formatMetricValue(analysis.metrics[0], 0.945)).toBe('94.5 %');
    expect(option.visualMap).toMatchObject({
      right: 1,
      itemHeight: 92,
      text: ['better', 'worse'],
      inRange: { color: ['#edf3f5', '#d7e7ed', '#b7d2de', '#8eb8ca', '#5f91aa'] },
    });
    expect(option.grid).toMatchObject({ left: 78, right: 60, top: 12, bottom: 50 });
    expect(option.xAxis).toMatchObject({ nameGap: 34 });
    expect(option.yAxis).toMatchObject({ nameGap: 54 });
  });

  it('maps lower-is-better metrics to the darker end of the scale', () => {
    const facet = sweepFacets(analysis)[0];
    const option = sweepChartOption(
      analysis,
      { ...analysis.metrics[0], key: 'tpot_mean_ms', objective: 'minimize' },
      facet,
      null,
    );

    expect(option.visualMap).toMatchObject({
      text: ['worse', 'better'],
      inRange: { color: ['#5f91aa', '#8eb8ca', '#b7d2de', '#d7e7ed', '#edf3f5'] },
    });
  });
});
