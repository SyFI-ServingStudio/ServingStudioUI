import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type * as Artifacts from '../../artifacts';

const fixture = vi.hoisted(() => ({
  reads: new Map<string, unknown>(),
}));

vi.mock('../../artifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof Artifacts>()),
  useArtifact: (ref: { kind: string }) => fixture.reads.get(ref.kind),
  useArtifacts: () => [],
}));

import type { Location } from '../../location';
import { KernelMeasurementPage } from './KernelMeasurementPage';

const LOCATION: Extract<Location, { view: 'result' }> = {
  view: 'result',
  ref: { kind: 'kernelMeasurement', id: 'km_one', workspace: 'w_main' },
  focus: { path: [], cursorMs: null, panel: null, options: {} },
  chat: null,
};

describe('KernelMeasurementPage loading state', () => {
  it('stays pending when the descriptor is ready before the summary', () => {
    fixture.reads.set('kernelMeasurementDescriptor', {
      status: 'ready',
      schemaVersion: 1,
      revision: '',
      value: {
        schemaVersion: 1,
        workspaceId: 'w_main',
        measurementId: 'km_one',
        displayName: 'measurement',
        legacy: false,
        createdAt: null,
        kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metricFamily: 'compute' },
        gpu: { cacheKey: 'H200', observedName: 'NVIDIA H200', count: 1 },
        shape: null,
        durationSeconds: 1,
        telemetry: false,
        lifecycle: 'complete',
        plotUrls: [],
      },
    });
    fixture.reads.set('kernelMeasurementSummary', { status: 'pending' });

    render(<KernelMeasurementPage location={LOCATION} navigate={vi.fn()} />);

    expect(screen.getByText('Kernel measurement is pending in Analyzer.')).toBeVisible();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });
});
