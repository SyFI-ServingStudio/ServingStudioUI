import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Workspace, WorkspaceKind } from '../../session/types';
import WorkspacePicker, { type WorkspaceChoice } from './WorkspacePicker';

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

function show({
  kinds = ['copy', 'worktree'] as readonly WorkspaceKind[],
  selection = { create: 'copy' } as WorkspaceChoice,
  onSelect = vi.fn(),
}: {
  kinds?: readonly WorkspaceKind[] | null;
  selection?: WorkspaceChoice;
  onSelect?: (choice: WorkspaceChoice) => void;
} = {}) {
  render(
    <WorkspacePicker
      workspaces={[workspace(), copy]}
      kinds={kinds}
      selection={selection}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('WorkspacePicker', () => {
  it('offers both creatable kinds first and reports which one was picked', async () => {
    const user = userEvent.setup();
    const onSelect = show();

    const options = screen.getAllByRole('option');
    // Creation leads, copy before worktree, then existing workspaces by recency.
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'Create a sandboxed copy',
      'Create a git worktree',
      'Select Throughput study',
      'Select Main',
    ]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('option', { name: 'Create a git worktree' }));
    expect(onSelect).toHaveBeenLastCalledWith({ create: 'worktree' });

    await user.click(screen.getByRole('option', { name: 'Select Main' }));
    expect(onSelect).toHaveBeenLastCalledWith({ existing: 'w_main' });
  });

  it('hides the worktree row on a backend that does not name its kinds', () => {
    // No announcement is an old backend, which cannot make one and would answer
    // a request for it with a validation error rather than an explanation.
    show({ kinds: null });
    expect(screen.queryByRole('option', { name: 'Create a git worktree' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Create a sandboxed copy' })).toBeEnabled();
  });

  it('shows the worktree row refused when the backend has the feature off', () => {
    const onSelect = show({ kinds: ['copy'] });

    // Visible and disabled, not hidden: a reader who was told this exists needs
    // to see that it is the server saying no, not that it was never built.
    const row = screen.getByRole('option', { name: 'Create a git worktree' });
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent('This server does not offer worktree workspaces.');
    // `fireEvent`, not `user.click`: the pointer would never reach a disabled
    // button, and what this asserts is the second defence — an event that does
    // land selects nothing.
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('states where each workspace runs outside the column that mobile drops', () => {
    show();
    // The tag column is `display:{xs:'none'}`, and "no sandbox around the
    // agent" is not a fact that may vanish with the viewport.
    expect(screen.getByRole('option', { name: 'Select Main' })).toHaveTextContent(
      'checkout · host',
    );
    expect(screen.getByRole('option', { name: 'Select Throughput study' })).toHaveTextContent(
      'copy · container',
    );
  });

  it('names the branch a worktree owns beside where it runs', () => {
    render(
      <WorkspacePicker
        workspaces={[
          workspace({
            id: 'w_wt',
            label: 'Decode study',
            kind: 'worktree',
            branch: 'decode-study',
          }),
        ]}
        kinds={['copy', 'worktree']}
        selection={{ create: 'copy' }}
        onSelect={vi.fn()}
      />,
    );
    // The branch is how someone finds this work in their own checkout, and it
    // is the server's answer rather than anything derived here.
    expect(screen.getByRole('option', { name: 'Select Decode study' })).toHaveTextContent(
      'worktree · host · decode-study',
    );
  });

  it('hides the creation rows while a search is narrowing the list', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByRole('textbox', { name: 'Search workspaces' }), 'through');
    // Searching is how someone says they want an existing workspace, so an
    // unfiltered creation row on top of the results would be in the way.
    expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.clear(screen.getByRole('textbox', { name: 'Search workspaces' }));
    await user.type(screen.getByRole('textbox', { name: 'Search workspaces' }), 'nothing');
    expect(screen.getByRole('status')).toHaveTextContent('No workspace matches this search.');
  });

  it('matches on the workspace id as well as its label', async () => {
    const user = userEvent.setup();
    show();

    // An unnamed workspace is labelled with its id, so the id has to be findable.
    await user.type(screen.getByRole('textbox', { name: 'Search workspaces' }), 'w_copy');
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('aria-label')),
    ).toEqual(['Select Throughput study']);
  });
});
