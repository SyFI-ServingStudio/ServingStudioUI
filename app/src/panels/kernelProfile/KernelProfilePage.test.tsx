import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type * as Artifacts from '../../artifacts';

const fixture = vi.hoisted(() => ({
  reads: new Map<string, unknown>(),
}));

vi.mock('../../artifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof Artifacts>()),
  useArtifact: (ref: { kind: string }) => fixture.reads.get(ref.kind),
}));

import type { Location } from '../../location';
import { KernelProfilePage } from './KernelProfilePage';

const LOCATION: Extract<Location, { view: 'result' }> = {
  view: 'result',
  ref: { kind: 'kernelProfile', id: 'kp_one', workspace: 'w_main' },
  focus: { path: [], cursorMs: null, panel: null, options: {} },
  chat: null,
};

describe('KernelProfilePage loading state', () => {
  it('stays pending when the descriptor is ready before the curve', () => {
    fixture.reads.set('kernelProfileDescriptor', {
      status: 'ready',
      schemaVersion: 1,
      revision: '',
      value: {
        schemaVersion: 1,
        workspaceId: 'w_main',
        profileId: 'kp_one',
        displayName: 'profile',
        legacy: false,
        mode: null,
        createdAt: null,
        kernel: { kind: 'gemm', table: 'single_gemm', backend: 'torch', metricFamily: 'compute' },
        gpu: null,
        provenanceSource: 'measurement',
        lifecycle: 'complete',
      },
    });
    fixture.reads.set('kernelProfileCurve', { status: 'pending' });

    render(<KernelProfilePage location={LOCATION} navigate={vi.fn()} />);

    expect(screen.getByText('Kernel profile is pending in Analyzer.')).toBeVisible();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
  });
});
