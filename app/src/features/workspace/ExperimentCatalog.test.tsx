import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ManagedJobListItem } from '../../application/managedJobRepository';
import type { OfflineResourceCatalogItem } from '../../domain/offlineResource';
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
    analyzerResourceId: 'kp_profile',
    jobKind: 'kernel_profile',
    status: 'ready',
    createdAt: 1785513600,
    updatedAt: 1785513600,
  },
];

const offlineResources: readonly OfflineResourceCatalogItem[] = [
  {
    workspaceId: 'w_main',
    resourceId: 'kp_profile',
    kind: 'kernel_profile',
    displayName: '20260731_0_single_gemm_profile',
    status: 'ready',
    updatedAt: '2026-07-31T00:00:00Z',
    kernelKind: 'single_gemm',
    table: 'single_gemm',
    backend: 'torch',
    metricFamily: 'compute',
  },
];

describe('ExperimentCatalog', () => {
  it('searches result metadata and restores rows when cleared', async () => {
    const user = userEvent.setup();
    render(
      <ExperimentCatalog
        entries={entries}
        jobs={[]}
        offlineResources={[]}
        workspaceNames={{ w_main: 'Main workspace' }}
        onActivate={vi.fn()}
        onActivateOfflineResource={vi.fn()}
      />,
    );
    const search = screen.getByRole('textbox', { name: 'Search results' });
    await user.type(search, ' SHAREGPT ');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(
      screen.getByRole('option', { name: 'Open Simulation afd_ui_reanalysis' }),
    ).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'missing-result');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('No results match');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.type(search, 'Main workspace');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('combines column filters without replacing the stable table shell', async () => {
    const user = userEvent.setup();
    render(
      <ExperimentCatalog
        entries={entries}
        jobs={[]}
        offlineResources={[]}
        onActivate={vi.fn()}
        onActivateOfflineResource={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /deployment/i }));
    await user.click(screen.getByRole('button', { name: 'afd' }));

    expect(screen.getByText('1 matches')).toBeInTheDocument();
    expect(screen.getByText('afd_ui_reanalysis')).toBeInTheDocument();
    const filteredRow = screen.getByLabelText('Open Simulation llama3_8b_tp_rate');
    expect(filteredRow).not.toBeVisible();
    expect(
      screen.queryByRole('option', { name: '20260727_0_llama3_8b_tp_rate' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Result table columns')).toBeInTheDocument();
  });

  it('mixes typed jobs with simulations and filters them by result type', async () => {
    const user = userEvent.setup();
    const onActivateOfflineResource = vi.fn();
    render(
      <ExperimentCatalog
        entries={entries}
        jobs={jobs}
        offlineResources={offlineResources}
        onActivate={vi.fn()}
        onActivateOfflineResource={onActivateOfflineResource}
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
    expect(onActivateOfflineResource).toHaveBeenCalledWith(offlineResources[0], 'w_main');
  });
});
