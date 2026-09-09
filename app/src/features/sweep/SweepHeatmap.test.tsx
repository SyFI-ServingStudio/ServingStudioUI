import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SweepAnalysis, SweepMetric } from '../../domain/sweep';
import SweepHeatmap from './SweepHeatmap';
import { sweepFacets } from './sweepOption';

const metric: SweepMetric = {
  key: 'ttft_mean_ms',
  label: 'Mean TTFT',
  group: 'slo',
  unit: 'ms',
  objective: 'minimize',
};

const analysis: SweepAnalysis = {
  protocolVersion: 1,
  schemaVersion: 1,
  workspaceId: 'w_main',
  sweepId: 's_grid',
  displayName: 'grid sweep',
  axes: ['request_rate', 'tensor_parallel'],
  domains: { request_rate: [10, 20], tensor_parallel: [1, 2] },
  metrics: [metric],
  runs: [
    {
      runId: 'r_fast',
      coordinates: { request_rate: 10, tensor_parallel: 2 },
      labels: {},
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { ttft_mean_ms: 12 },
    },
    {
      runId: 'r_slow',
      coordinates: { request_rate: 20, tensor_parallel: 1 },
      labels: {},
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { ttft_mean_ms: 120 },
    },
  ],
  definitions: {},
};

describe('SweepHeatmap', () => {
  it('renders an accessible native grid and emits the existing chart event contract', () => {
    const onCellClick = vi.fn();
    render(
      <SweepHeatmap
        analysis={analysis}
        metric={metric}
        facet={sweepFacets(analysis)[0]!}
        selectedRunKey={null}
        ariaLabel="TTFT sweep"
        height={280}
        onCellClick={onCellClick}
        onCellDoubleClick={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'TTFT sweep' })).toBeInTheDocument();
    const fastCell = screen.getByRole('button', {
      name: 'Mean TTFT, request_rate 10, tensor_parallel 2, 12.0 ms',
    });
    expect(
      screen.getByRole('button', {
        name: 'Mean TTFT, request_rate 20, tensor_parallel 1, 120 ms',
      }),
    ).toBeVisible();

    fireEvent.click(fastCell);
    expect(onCellClick).toHaveBeenCalledWith({
      data: {
        runId: 'r_fast',
        runKey: 'request_rate:10|tensor_parallel:2',
        coordinates: { request_rate: 10, tensor_parallel: 2 },
      },
    });
  });
});
