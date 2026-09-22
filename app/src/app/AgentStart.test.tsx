import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace, WorkspaceKind } from '../session/types';
import AgentStart from './AgentStart';

vi.mock('../session/api', () => ({
  createWorkspace: vi.fn(),
  listCodexBackends: vi.fn(),
}));

const api = await import('../session/api');
const createWorkspace = vi.mocked(api.createWorkspace);
const listCodexBackends = vi.mocked(api.listCodexBackends);

const existing: Workspace = {
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
};

const runtime = { model: 'm', effort: 'high', serviceTier: 'default' } as const;

beforeEach(() => {
  window.localStorage.clear();
  listCodexBackends.mockResolvedValue({
    models: [
      {
        id: 'm',
        label: 'M',
        family: 'f',
        familyLabel: 'F',
        available: true,
        efforts: ['high'],
        defaultEffort: 'high',
        serviceTiers: ['default'],
        defaultServiceTier: 'default',
      },
    ],
    defaults: { orchestrator: runtime, implementer: runtime, assistant: runtime },
  });
});

afterEach(() => vi.clearAllMocks());

/** Walk the three steps and submit; returns the navigate spy. */
async function ask(
  prompt: string,
  {
    workspace,
    create = 'sandboxed copy',
    kinds = ['copy', 'worktree'] as WorkspaceKind[],
  }: {
    workspace?: string;
    create?: 'sandboxed copy' | 'git worktree';
    kinds?: WorkspaceKind[] | null;
  } = {},
) {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<AgentStart workspaces={[existing]} kinds={kinds} navigate={navigate} />);
  await user.click(screen.getAllByRole('radio')[0]);
  await user.click(
    screen.getByRole('option', {
      name: workspace ? `Select ${workspace}` : `Create a ${create}`,
    }),
  );
  await user.type(screen.getByRole('textbox', { name: 'Ask ServingStudio Agent' }), prompt);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  return { navigate, user };
}

describe('AgentStart', () => {
  it('creates a workspace named from the question and enters it as a draft', async () => {
    createWorkspace.mockResolvedValue({ ...existing, id: 'w_new', label: 'new' });
    const { navigate } = await ask('Why is decode slow?');

    await waitFor(() => expect(createWorkspace).toHaveBeenCalled());
    expect(createWorkspace.mock.calls[0]?.[0]).toBe('Why is decode slow?');
    expect(createWorkspace.mock.calls[0]?.[1]).toMatchObject({ kind: 'copy' });
    expect(navigate).toHaveBeenLastCalledWith(
      { view: 'chat', chat: { state: 'draft', workspace: 'w_new' } },
      'push',
    );
  });

  it('asks for a worktree when the reader picked one', async () => {
    createWorkspace.mockResolvedValue({ ...existing, id: 'w_wt', kind: 'worktree' });
    await ask('Profile the decode kernels', { create: 'git worktree' });

    await waitFor(() => expect(createWorkspace).toHaveBeenCalled());
    expect(createWorkspace.mock.calls[0]?.[1]).toMatchObject({ kind: 'worktree' });
  });

  it('does not create anything when an existing workspace was chosen', async () => {
    const { navigate } = await ask('Reuse this one', { workspace: 'Main' });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith(
      { view: 'chat', chat: { state: 'draft', workspace: 'w_main' } },
      'push',
    );
  });

  it('shows what the backend said and lets the question be sent again', async () => {
    createWorkspace.mockRejectedValueOnce(new Error('branch already exists (409)'));
    const { navigate, user } = await ask('First try');

    // The reason has to survive to the screen: it is the only thing telling
    // the reader what to change.
    expect(await screen.findByRole('alert')).toHaveTextContent('branch already exists (409)');
    expect(navigate).not.toHaveBeenCalled();

    createWorkspace.mockResolvedValue({ ...existing, id: 'w_second' });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenLastCalledWith(
        { view: 'chat', chat: { state: 'draft', workspace: 'w_second' } },
        'push',
      ),
    );
  });
});
