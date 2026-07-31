import { act, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <div>run</div> }));
vi.mock('./features/sweep', () => ({ SweepPage: () => <div>aggregate</div> }));
vi.mock('./features/workspace', () => ({
  EntryPage: () => <div>entry</div>,
  WorkspaceShell: ({
    children,
    view,
  }: {
    children: ReactNode;
    view: 'agent' | 'aggregate' | 'run';
  }) => {
    const [, query = ''] = window.location.hash.split('?', 2);
    return (
      <div>
        <span data-testid="agent-host">
          {`workspace:${new URLSearchParams(query).get('workspace')}`}
        </span>
        <span>{`view:${view}`}</span>
        {children}
      </div>
    );
  },
}));

import AppRoot from './AppRoot';

beforeEach(() => {
  window.history.replaceState(null, '', '#/agent?workspace=w_one');
});

describe('AppRoot workspace routing', () => {
  it('rerenders when a same-view hash selects another workspace', async () => {
    render(<AppRoot />);
    expect(await screen.findByText('workspace:w_one')).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, '', '#/agent?workspace=w_two');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(await screen.findByText('workspace:w_two')).toBeInTheDocument();
    expect(screen.queryByText('workspace:w_one')).not.toBeInTheDocument();
  });

  it('preserves the workspace Agent host while legacy routes change layout', async () => {
    render(<AppRoot />);
    const agentHost = await screen.findByTestId('agent-host');
    expect(screen.getByText('view:agent')).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, '', '#/aggregate?workspace=w_one&experiment=s_test');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(await screen.findByText('view:aggregate')).toBeInTheDocument();
    expect(await screen.findByText('aggregate')).toBeInTheDocument();
    expect(screen.getByTestId('agent-host').isSameNode(agentHost)).toBe(true);
  });
});
