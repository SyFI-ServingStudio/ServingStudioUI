import { describe, expect, it } from 'vitest';

import type { SweepAnalysis } from '../../domain/sweep';
import {
  formatMetricValue,
  sweepAxisTickLabel,
  sweepChartOption,
  sweepFacets,
} from './sweepOption';

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
    expect(option.visualMap).toMatchObject({ text: ['better', 'worse'] });
  });

  it('maps lower-is-better metrics to the better end of the theme scale', () => {
    const facet = sweepFacets(analysis)[0];
    const option = sweepChartOption(
      analysis,
      { ...analysis.metrics[0], key: 'tpot_mean_ms', objective: 'minimize' },
      facet,
      null,
    );

    expect(option.visualMap).toMatchObject({ text: ['worse', 'better'] });
  });

  it('keeps one-axis labels inside the panel and compacts engineering-scale ticks', () => {
    const oneAxisAnalysis = {
      ...analysis,
      axes: ['request_rate'],
      domains: { request_rate: [10, 20] },
    };
    const option = sweepChartOption(
      oneAxisAnalysis,
      analysis.metrics[0],
      { key: 'all', label: 'All runs', runs: oneAxisAnalysis.runs },
      null,
    );

    expect(option.grid).toMatchObject({ left: 72, right: 20, top: 24, bottom: 64 });
    expect(option.xAxis).toMatchObject({ nameLocation: 'middle', nameGap: 38 });
    expect(option.yAxis).toMatchObject({ nameLocation: 'middle', nameGap: 54, scale: true });
    expect(option.yAxis).not.toHaveProperty('min');
    expect(option.yAxis).not.toHaveProperty('max');
    expect(sweepAxisTickLabel(999)).toBe('999');
    expect(sweepAxisTickLabel(12_400)).toBe('12.4K');
  });
});
