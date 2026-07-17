import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { KernelInputPosition } from '../../domain/kernelInputDistribution';
import { kernelInputDistributionOption } from './kernelInputDistributionOptions';

const position: KernelInputPosition = {
  name: 'attention.prefill',
  kind: 'flashinfer_attn_prefill',
  candidateBackends: ['fa2', 'fa3'],
  selection: [
    { backendIndex: 0, backendName: 'fa2', count: 3, ratio: 0.75 },
    { backendIndex: 1, backendName: 'fa3', count: 1, ratio: 0.25 },
  ],
  projection: 'raw_2d',
  axisLabels: ['batch_size', 'total_tokens'],
  explainedVariance: null,
  points: [
    { x: 2, y: 128, backendIndex: 0, backendName: 'fa2', count: 3 },
    { x: 4, y: 512, backendIndex: 1, backendName: 'fa3', count: 1 },
  ],
};

describe('kernel input distribution chart option', () => {
  it('builds one scatter series per backend with weighted point values', () => {
    const option = kernelInputDistributionOption(position, CHART_THEME);
    const series = option.series as Array<{ name: string; type: string; data: number[][] }>;

    expect(series).toMatchObject([
      { name: 'fa2', type: 'scatter', data: [[2, 128, 3]] },
      { name: 'fa3', type: 'scatter', data: [[4, 512, 1]] },
    ]);
    expect(option.xAxis).toMatchObject({ name: 'batch_size' });
    expect(option.yAxis).toMatchObject({ name: 'total_tokens' });
  });

  it('adds weighted backend density curves and a probability-density y axis for 1D', () => {
    const option = kernelInputDistributionOption(
      { ...position, projection: 'feature_1d', axisLabels: ['batch_size', ''] },
      CHART_THEME,
    );
    const series = option.series as Array<{
      type: string;
      data: Array<[number, number, number?]>;
    }>;
    const curves = series.filter((candidate) => candidate.type === 'line');

    expect(series.filter((candidate) => candidate.type === 'scatter')).toHaveLength(2);
    expect(curves).toHaveLength(2);
    expect(option.yAxis).toMatchObject({
      name: 'Probability density',
      min: 0,
      axisLabel: { show: true },
    });

    const area = (points: Array<[number, number, number?]>) =>
      points.slice(1).reduce((sum, point, index) => {
        const previous = points[index];
        return sum + ((point[1] + previous[1]) / 2) * (point[0] - previous[0]);
      }, 0);
    const areas = curves.map((curve) => area(curve.data));
    expect(areas[0]).toBeCloseTo(0.75, 2);
    expect(areas[1]).toBeCloseTo(0.25, 2);
    expect(areas[0] + areas[1]).toBeCloseTo(1, 2);
  });
});
