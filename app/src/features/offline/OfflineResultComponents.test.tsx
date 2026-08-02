import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { KernelProfileCurve } from '../../domain/offlineResource';

const chartRender = vi.hoisted(() => vi.fn());
vi.mock('../../components/EChart', () => ({
  default: () => {
    chartRender();
    return <div>chart</div>;
  },
}));
vi.mock('../../components/ChartFocusContext', () => ({
  useOpenChartFocus: () => vi.fn(),
}));

import { KernelCurve } from './OfflineResultComponents';

const curve: KernelProfileCurve = {
  schemaVersion: 1,
  resourceKind: 'kernel_profile_curve',
  kernelKind: 'gemm',
  table: 'single_gemm',
  backend: 'torch',
  metricFamily: 'compute',
  axes: [{ key: 'm', values: [1, 2] }],
  fixedArgs: { n: 4096 },
  layout: { xAxis: 'm', yAxis: null, facets: [] },
  series: [
    { metric: 'time_ms', unit: 'ms', lowerIsBetter: true },
    { metric: 'tflops', unit: 'TFLOP/s', lowerIsBetter: false },
  ],
  rows: [
    { index: 0, coordinates: { m: 1 }, args: {}, status: 'ok', metrics: { time_ms: 1, tflops: 2 } },
    { index: 1, coordinates: { m: 2 }, args: {}, status: 'ok', metrics: { time_ms: 2, tflops: 3 } },
  ],
};

describe('offline result evidence cards', () => {
  it('changes the selected shell without rerendering stable profile charts', () => {
    const { rerender } = render(
      <KernelCurve curve={curve} selectedMetric={null} onMetricSelect={vi.fn()} />,
    );
    expect(chartRender).toHaveBeenCalledTimes(2);

    rerender(<KernelCurve curve={curve} selectedMetric="time_ms" onMetricSelect={vi.fn()} />);

    expect(chartRender).toHaveBeenCalledTimes(2);
  });
});
