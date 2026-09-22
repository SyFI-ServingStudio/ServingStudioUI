import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Workspace } from '../../session/types';
import WorkspacePicker from './WorkspacePicker';

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w_main',
    label: 'Main',
    archived: false,
    storageKind: 'external',
    kind: 'checkout',
    execution: 'host',
    branch: null,
    createdAt: 1,
    lastAccessedAt: 10,
    namingState: 'manual',
    ...overrides,
  };
}

const copy = workspace({
  id: 'w_copy',
  label: 'Throughput study',
  storageKind: 'managed',
  kind: 'copy',
  execution: 'container',
  lastAccessedAt: 20,
});

describe('WorkspacePicker', () => {
  it('offers creation first and reports the choice as a null id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <WorkspacePicker workspaces={[workspace(), copy]} selectedWorkspaceId={null} onSelect={onSelect} />,
    );

    const options = screen.getAllByRole('option');
    // Creation leads, then existing workspaces by recency.
    expect(options[0]).toHaveAttribute('aria-label', 'Create a new workspace');
    expect(options.slice(1).map((option) => option.getAttribute('aria-label'))).toEqual([
      'Select Throughput study',
      'Select Main',
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('option', { name: 'Select Main' }));
    expect(onSelect).toHaveBeenLastCalledWith('w_main');
  });

  it('hides the creation row while a search is narrowing the list', async () => {
    const user = userEvent.setup();
    render(
      <WorkspacePicker workspaces={[workspace(), copy]} selectedWorkspaceId={null} onSelect={vi.fn()} />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Search workspaces' }), 'through');
    // Searching is how someone says they want an existing workspace, so an
    // unfiltered creation row on top of the results would be in the way.
    expect(screen.queryByRole('option', { name: 'Create a new workspace' })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.clear(screen.getByRole('textbox', { name: 'Search workspaces' }));
    await user.type(screen.getByRole('textbox', { name: 'Search workspaces' }), 'nothing');
    expect(screen.getByRole('status')).toHaveTextContent('No workspace matches this search.');
  });

  it('matches on the workspace id as well as its label', async () => {
    const user = userEvent.setup();
    render(
      <WorkspacePicker workspaces={[workspace(), copy]} selectedWorkspaceId={null} onSelect={vi.fn()} />,
    );

    // An unnamed workspace is labelled with its id, so the id has to be findable.
    await user.type(screen.getByRole('textbox', { name: 'Search workspaces' }), 'w_copy');
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))).toEqual(
      ['Select Throughput study'],
    );
  });
});
