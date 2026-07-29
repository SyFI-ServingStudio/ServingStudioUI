import { act, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <div>run</div> }));
vi.mock('./features/sweep', () => ({ SweepPage: () => <div>aggregate</div> }));
vi.mock('./features/workspace', () => ({
  EntryPage: () => <div>entry</div>,
  AgentPage: () => {
    const [, query = ''] = window.location.hash.split('?', 2);
    return <div>{`agent:${new URLSearchParams(query).get('workspace')}`}</div>;
  },
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import AppRoot from './AppRoot';

beforeEach(() => {
  window.history.replaceState(null, '', '#/agent?workspace=w_one');
});

describe('AppRoot workspace routing', () => {
  it('rerenders when a same-view hash selects another workspace', async () => {
    render(<AppRoot />);
    expect(await screen.findByText('agent:w_one')).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, '', '#/agent?workspace=w_two');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(await screen.findByText('agent:w_two')).toBeInTheDocument();
    expect(screen.queryByText('agent:w_one')).not.toBeInTheDocument();
  });
});
