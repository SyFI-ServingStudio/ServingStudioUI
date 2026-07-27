import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SweepListItem } from '../../domain/sweep';
import ExperimentCatalog from './ExperimentCatalog';

const entries: readonly SweepListItem[] = [
  {
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

describe('ExperimentCatalog', () => {
  it('shows concise real experiment names and activates a row', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<ExperimentCatalog entries={entries} onActivate={onActivate} />);

    expect(screen.getByText('llama3_8b_tp_rate')).toBeInTheDocument();
    expect(screen.queryByText('20260727_0_llama3_8b_tp_rate')).not.toBeInTheDocument();
    expect(screen.getByText('6 runs')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: '20260727_0_llama3_8b_tp_rate' }));
    expect(onActivate).toHaveBeenCalledWith(entries[0]);
  });

  it('combines column filters without replacing the stable table shell', async () => {
    const user = userEvent.setup();
    render(<ExperimentCatalog entries={entries} onActivate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /deployment/i }));
    await user.click(screen.getByRole('button', { name: 'afd' }));

    expect(screen.getByText('1 matches, newest first')).toBeInTheDocument();
    expect(screen.getByText('afd_ui_reanalysis')).toBeInTheDocument();
    const filteredRow = screen.getByLabelText('20260727_0_llama3_8b_tp_rate');
    expect(filteredRow).toHaveStyle({
      maxHeight: '0',
      opacity: '0',
      transform: 'translateY(-7px)',
    });
    expect(getComputedStyle(filteredRow).transition).toContain('max-height 380ms');
    expect(
      screen.queryByRole('option', { name: '20260727_0_llama3_8b_tp_rate' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Experiment table columns')).toBeInTheDocument();
  });
});
