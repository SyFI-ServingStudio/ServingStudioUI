import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ManagedJobListItem } from '../../application/managedJobRepository';
import type { SweepListItem } from '../../domain/sweep';
import ExperimentCatalog from './ExperimentCatalog';

const entries: readonly SweepListItem[] = [
  {
    workspaceId: 'w_main',
    sweepId: 's_new',
    kind: 'sweep',
    displayName: '20260727_0_llama3_8b_tp_rate',
    axes: ['request_rate', 'tensor_parallel'],
    numRuns: 6,
    status: 'ready',
    experimentDate: '2026-07-27',
    deployments: ['unified'],
    traces: ['aime_long.csv'],
    updatedAt: '2026-07-27T12:00:00Z',
  },
  {
    workspaceId: 'w_main',
    sweepId: 's_old',
    kind: 'singleton',
    displayName: '20260715_1_afd_ui_reanalysis',
    axes: [],
    numRuns: 1,
    status: 'ready',
    experimentDate: '2026-07-15',
    deployments: ['afd'],
    traces: ['sharegpt.csv'],
    updatedAt: '2026-07-15T12:00:00Z',
  },
];

const jobs: readonly ManagedJobListItem[] = [
  {
    workspaceId: 'w_main',
    jobId: 'j_profile',
    conversationId: 'c_profile',
    conversationTitle: 'Kernel study',
    resourceId: 'jr_profile',
    jobKind: 'kernel_profile',
    status: 'ready',
    artifactPath: '20260731_0_single_gemm_profile',
    descriptor: { table: 'single_gemm', backend: 'torch', pointCount: 3 },
    summary: { axes: ['m'], missingCount: 0 },
    createdAt: 1785513600,
    updatedAt: 1785513600,
  },
];

describe('ExperimentCatalog', () => {
  it('shows concise real experiment names and activates a row', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <ExperimentCatalog
        entries={entries}
        jobs={[]}
        onActivate={onActivate}
        onActivateJob={vi.fn()}
      />,
    );

    expect(screen.getByText('llama3_8b_tp_rate')).toBeInTheDocument();
    expect(screen.queryByText('20260727_0_llama3_8b_tp_rate')).not.toBeInTheDocument();
    expect(screen.getByText('6 runs')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Open Simulation llama3_8b_tp_rate' }));
    expect(onActivate).toHaveBeenCalledWith(entries[0]);
  });

  it('combines column filters without replacing the stable table shell', async () => {
    const user = userEvent.setup();
    render(
      <ExperimentCatalog
        entries={entries}
        jobs={[]}
        onActivate={vi.fn()}
        onActivateJob={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /deployment/i }));
    await user.click(screen.getByRole('button', { name: 'afd' }));

    expect(screen.getByText('1 matches')).toBeInTheDocument();
    expect(screen.getByText('afd_ui_reanalysis')).toBeInTheDocument();
    const filteredRow = screen.getByLabelText('Open Simulation llama3_8b_tp_rate');
    expect(filteredRow).toHaveStyle({
      maxHeight: '0',
      opacity: '0',
      transform: 'translateY(-7px)',
    });
    expect(getComputedStyle(filteredRow).transition).toContain('max-height 380ms');
    expect(
      screen.queryByRole('option', { name: '20260727_0_llama3_8b_tp_rate' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Result table columns')).toBeInTheDocument();
  });

  it('mixes typed jobs with simulations and filters them by result type', async () => {
    const user = userEvent.setup();
    const onActivateJob = vi.fn();
    render(
      <ExperimentCatalog
        entries={entries}
        jobs={jobs}
        onActivate={vi.fn()}
        onActivateJob={onActivateJob}
      />,
    );

    expect(screen.getByText('single_gemm')).toBeInTheDocument();
    expect(screen.getByText('Kernel profile')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /type/i }));
    await user.click(screen.getByRole('button', { name: 'Kernel profile' }));
    await user.keyboard('{Escape}');

    const visibleRows = screen.getAllByRole('option');
    expect(visibleRows).toHaveLength(1);
    await user.click(visibleRows[0]!);
    expect(onActivateJob).toHaveBeenCalledWith(jobs[0]);
  });
});
