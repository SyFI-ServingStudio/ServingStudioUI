import { describe, expect, it } from 'vitest';

import type { ThroughputTimeline } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import { throughputChartData, throughputOption } from './option';

const timeline: ThroughputTimeline = {
  fine: {
    startMs: [0, 1_000],
    endMs: [1_000, 2_000],
    series: [
      { key: 'total', label: 'Total', perGpu: [5, 10] },
      { key: 'prefill', label: 'Prefill', perGpu: [2, 4] },
      { key: 'decode', label: 'Decode', perGpu: [3, 6] },
    ],
  },
  coarse: {
    startMs: [0],
    endMs: [2_000],
    series: [
      { key: 'total', label: 'Total', perGpu: [7.5] },
      { key: 'prefill', label: 'Prefill', perGpu: [3] },
      { key: 'decode', label: 'Decode', perGpu: [4.5] },
    ],
  },
  sourceLogDir: 'logs/example',
  gpuName: 'NVIDIA H200',
  gpus: 2,
  unit: 'tokens/s per GPU',
  averagesPerGpu: { total: 7.5, prefill: 3, decode: 4.5 },
  definitions: {},
};

describe('throughputOption', () => {
  it('keeps the accepted fine step chart from the same cluster rates', () => {
    const data = throughputChartData(timeline);
    expect(throughputOption(data, CHART_THEME, 0.5)).toMatchSnapshot();
  });

  it('projects the producer coarse view and restores cluster rates', () => {
    expect(throughputChartData(timeline, 'coarse')).toEqual({
      startMs: [0],
      endMs: [2_000],
      total: [15],
      prefill: [6],
      decode: [9],
    });
  });

  it('falls back to fine data for old schema-v1 payloads without coarse bins', () => {
    expect(throughputChartData({ ...timeline, coarse: null }, 'coarse')).toEqual(
      throughputChartData(timeline, 'fine'),
    );
  });
});
