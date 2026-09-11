import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  KernelMeasurementDescriptor,
  KernelProfileCurve,
} from '../../artifacts/schema/offlineResource';

const chartRender = vi.hoisted(() => vi.fn());
vi.mock('../../ui/controls/EChart', () => ({
  default: () => {
    chartRender();
    return <div>chart</div>;
  },
}));
vi.mock('../../ui/controls/ChartFocusContext', () => ({
  useOpenChartFocus: () => vi.fn(),
}));

import { KernelCurve, PlotGallery } from './OfflineResultComponents';

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

  it('keeps a raw plot name through display, selection, and click', () => {
    const select = vi.fn();
    const descriptor: KernelMeasurementDescriptor = {
      schemaVersion: 1,
      workspaceId: 'w_main',
      measurementId: 'km_one',
      displayName: 'measure',
      legacy: false,
      createdAt: null,
      kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metricFamily: 'compute' },
      gpu: { cacheKey: 'H200', observedName: 'NVIDIA H200', count: 1 },
      shape: null,
      durationSeconds: 1,
      telemetry: false,
      lifecycle: 'complete',
      plotUrls: [
        'http://localhost/api/analyzer/v1/kernel-measurements/km_one/plots/runtime%20trend.png',
      ],
    };
    render(
      <PlotGallery
        descriptor={descriptor}
        selectedPlot="runtime trend.png"
        onPlotSelect={select}
      />,
    );

    const plot = screen.getByRole('img', { name: 'runtime trend.png' });
    expect(plot.closest('[data-agent-selected]')).toHaveAttribute('data-agent-selected', 'true');
    fireEvent.click(plot);
    expect(select).toHaveBeenCalledWith('runtime trend.png');
  });
});
