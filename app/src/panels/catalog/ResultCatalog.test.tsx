import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogEntry } from '../../artifacts';
import type { CatalogFilter } from '../../location';
import type { ManagedJob } from '../../session/types';
import ResultCatalog from './ResultCatalog';

const filter: CatalogFilter = { workspace: 'w_main', kinds: [], query: null };
const entry: CatalogEntry = {
  kind: 'sweep',
  id: 's1',
  workspace: 'w_other',
  displayName: '20260910_0_result',
  status: 'ready',
  updatedAt: '2026-09-10T00:00:00Z',
  numRuns: 2,
};

describe('ResultCatalog', () => {
  it('commits workspace and metadata filters through Location', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { rerender } = render(
      <ResultCatalog
        entries={[entry]}
        filter={filter}
        navigate={navigate}
        workspaceNames={{ w_other: 'Other workspace' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /workspace/i }));
    await user.click(screen.getByRole('button', { name: 'Other workspace' }));
    expect(navigate).toHaveBeenLastCalledWith(
      {
        view: 'catalog',
        filter: { ...filter, workspaces: ['w_other'] },
      },
      'replace',
    );

    rerender(
      <ResultCatalog
        entries={[entry]}
        filter={{ ...filter, workspaces: ['w_other'] }}
        navigate={navigate}
        workspaceNames={{ w_other: 'Other workspace' }}
      />,
    );
    expect(screen.getByText('1 matches')).toBeInTheDocument();
  });

  it('keeps an undiscovered managed job visible but inactive', () => {
    const job: ManagedJob = {
      workspaceId: 'w_main',
      jobId: 'j1',
      conversationId: 'c1',
      conversationTitle: 'Kernel study',
      resourceId: 'pending-profile',
      analyzerResourceId: null,
      jobKind: 'kernel_profile',
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
    };
    render(<ResultCatalog entries={[]} jobs={[job]} filter={filter} navigate={vi.fn()} />);
    expect(screen.getByText('Awaiting Analyzer discovery')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Kernel study/ })).toBeDisabled();
  });

  it('opens a singleton sweep through its analyzer-issued run identity', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <ResultCatalog
        entries={[{ ...entry, workspace: 'w_main', numRuns: 1, runId: 'r_single' }]}
        filter={filter}
        navigate={navigate}
      />,
    );

    await user.click(screen.getByRole('option', { name: /Open Simulation result/ }));
    expect(navigate).toHaveBeenCalledWith(
      {
        view: 'result',
        ref: { kind: 'run', id: 'r_single', workspace: 'w_main' },
        focus: expect.objectContaining({ path: [], panel: null, options: {} }),
        chat: null,
      },
      'push',
    );
  });
});
