import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SweepListItem } from '../../domain/sweep';
import ExperimentSelector from './ExperimentSelector';

const entries: readonly SweepListItem[] = [
  {
    sweepId: 'recent-sweep',
    kind: 'sweep',
    displayName: '20260727_0_rate_sweep',
    axes: ['request_rate'],
    numRuns: 5,
    status: 'ready',
    experimentDate: '2026-07-27',
    deployments: ['unified'],
    traces: ['aime_long.csv'],
    updatedAt: '2026-07-27T10:00:00Z',
  },
  {
    sweepId: 'recent-singleton',
    kind: 'singleton',
    displayName: '20260727_1_smoke',
    axes: [],
    numRuns: 1,
    status: 'ready',
    experimentDate: '2026-07-27',
    deployments: ['pd'],
    traces: ['smoke.csv'],
    updatedAt: '2026-07-27T09:00:00Z',
  },
  {
    sweepId: 'older-singleton',
    kind: 'singleton',
    displayName: '20260720_0_afd',
    axes: [],
    numRuns: 1,
    status: 'ready',
    experimentDate: '2026-07-20',
    deployments: ['afd'],
    traces: ['aime_long.csv'],
    updatedAt: '2026-07-20T08:00:00Z',
  },
];

describe('ExperimentSelector', () => {
  it('groups newest dates first and filters by deployment, trace, and search', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ExperimentSelector entries={entries} selectedId="recent-sweep" onSelect={onSelect} />);

    const listbox = screen.getByRole('listbox', { name: 'Experiments by date' });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      expect.stringContaining('0_rate_sweep'),
      expect.stringContaining('1_smoke'),
      expect.stringContaining('0_afd'),
    ]);

    await user.click(screen.getByRole('button', { name: 'afd' }));
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    expect(within(listbox).getByRole('option')).toHaveTextContent('0_afd');

    await user.click(screen.getByRole('button', { name: 'pd' }));
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'smoke.csv' }));
    expect(within(listbox).getByRole('option')).toHaveTextContent('1_smoke');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.type(screen.getByLabelText('Find experiment'), 'rate_sweep');
    expect(within(listbox).getByRole('option')).toHaveTextContent('0_rate_sweep');
  });

  it('moves selection with listbox arrow keys', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ExperimentSelector entries={entries} selectedId="recent-sweep" onSelect={onSelect} />);

    const selected = screen.getByRole('option', { name: /20260727_0_rate_sweep/ });
    selected.focus();
    await user.keyboard('{ArrowDown}');

    expect(onSelect).toHaveBeenCalledWith('recent-singleton');
  });

  it('separates explicit option activation from filter fallback selection', async () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <ExperimentSelector
        entries={entries}
        selectedId="recent-sweep"
        onSelect={onSelect}
        onActivate={onActivate}
      />,
    );

    await user.click(screen.getByRole('option', { name: '20260727_1_smoke' }));

    expect(onActivate).toHaveBeenCalledWith('recent-singleton');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
