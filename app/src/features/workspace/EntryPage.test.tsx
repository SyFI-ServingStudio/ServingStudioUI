import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listAllConversations } from '../../application/conversationRepository';
import type { WorkspaceSummary } from '../../application/workspaceRepository';
import ConversationCatalog from './ConversationCatalog';
import { AgentStart } from './EntryPage';

vi.mock('../../application/conversationRepository', () => ({
  listAllConversations: vi.fn(),
}));

const workspaces: readonly WorkspaceSummary[] = [
  {
    workspaceId: 'w_main',
    displayName: 'Main development',
    state: 'active',
    storageKind: 'external',
    createdAt: 1,
    lastAccessedAt: 1785168000,
    namingState: 'manual',
  },
  {
    workspaceId: 'w_kernel',
    displayName: 'Kernel exploration',
    state: 'active',
    storageKind: 'managed',
    createdAt: 1,
    lastAccessedAt: 1785254400,
    namingState: 'generated',
  },
];

describe('Page 0 conversation entry', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '#/');
    vi.mocked(listAllConversations).mockResolvedValue([
      {
        id: 'c_older',
        workspaceId: 'w_main',
        title: 'Serving comparison',
        naming_state: 'generated',
        updated_at: 1785168000,
      },
      {
        id: 'c_recent',
        workspaceId: 'w_kernel',
        title: 'Residual RMSNorm',
        naming_state: 'generated',
        updated_at: 1785254400,
      },
    ]);
  });

  it('places a compact workspace picker above the new-conversation composer', async () => {
    const user = userEvent.setup();
    render(<AgentStart workspaces={workspaces} />);

    const picker = screen.getByRole('listbox', { name: 'Workspace for new conversation' });
    const composer = screen.getByRole('textbox', { name: 'Ask VibeSim Agent' });
    expect(
      picker.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /context/i })).not.toBeInTheDocument();

    const workspace = screen.getByRole('option', { name: 'Select Kernel exploration' });
    await user.click(workspace);

    expect(window.location.hash).toBe('#/');
    expect(workspace).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('New conversation in Kernel exploration')).toBeInTheDocument();
  });

  it('offers a pinned clean-workspace choice', async () => {
    const user = userEvent.setup();
    render(<AgentStart workspaces={workspaces} />);

    const existingWorkspace = screen.getByRole('option', { name: 'Select Main development' });
    await user.click(existingWorkspace);
    await user.click(screen.getByRole('option', { name: 'Create a new workspace' }));

    expect(screen.getByText('A new workspace will be created')).toBeInTheDocument();
  });

  it('ranks resumable conversations globally and shows their workspace', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<ConversationCatalog workspaces={workspaces} onActivate={onActivate} />);

    const catalog = await screen.findByRole('list', { name: 'Conversations, newest first' });
    const rows = within(catalog).getAllByRole('listitem');
    expect(rows[0]).toHaveAccessibleName('Resume Residual RMSNorm in Kernel exploration');
    expect(rows[1]).toHaveAccessibleName('Resume Serving comparison in Main development');
    expect(within(rows[0]!).getByText('Kernel exploration')).toBeInTheDocument();

    await user.click(rows[0]!);
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'c_recent' }));
  });

  it('filters resumable conversations by one or more workspaces', async () => {
    const user = userEvent.setup();
    render(<ConversationCatalog workspaces={workspaces} onActivate={vi.fn()} />);

    await screen.findByRole('list', { name: 'Conversations, newest first' });
    await user.click(screen.getAllByRole('button', { name: 'Workspace' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Main development' }));
    await user.keyboard('{Escape}');

    const rows = within(
      screen.getByRole('list', { name: 'Conversations, newest first' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAccessibleName('Resume Serving comparison in Main development');
  });
});
