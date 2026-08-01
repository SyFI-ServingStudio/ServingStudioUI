import { act, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <div>run</div> }));
vi.mock('./features/sweep', () => ({ SweepPage: () => <div>aggregate</div> }));
vi.mock('./features/prediction', async () => {
  const { useOpenChartFocus } = await import('./components/ChartFocusContext');
  return {
    PredictionPage: ({ predictionId }: { predictionId: string }) => {
      useOpenChartFocus();
      return <div>{`prediction:${predictionId}`}</div>;
    },
  };
});
vi.mock('./features/file', () => ({
  FilePreviewPage: ({ fileRef }: { fileRef: { path: string; line: number | null } }) => (
    <div>{`file:${fileRef.path}:${fileRef.line ?? '-'}`}</div>
  ),
}));
vi.mock('./features/workspace', () => ({
  EntryPage: () => <div>entry</div>,
  WorkspaceShell: ({
    children,
    view,
  }: {
    children: ReactNode;
    view: 'agent' | 'aggregate' | 'prediction' | 'run' | 'file';
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

  it('renders a workspace file inside the same shell so the Agent stays mounted', async () => {
    render(<AppRoot />);
    const agentHost = await screen.findByTestId('agent-host');

    act(() => {
      window.history.replaceState(
        null,
        '',
        '#/file?workspace=w_one&path=logs%2Fsummary.json&line=7',
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(await screen.findByText('file:logs/summary.json:7')).toBeInTheDocument();
    expect(screen.getByText('view:file')).toBeInTheDocument();
    expect(screen.getByTestId('agent-host').isSameNode(agentHost)).toBe(true);
  });

  it('renders nothing for a file route the address bar cannot be trusted with', async () => {
    window.history.replaceState(null, '', '#/file?workspace=w_one&path=../../etc/passwd');

    render(<AppRoot />);

    expect(await screen.findByText('view:file')).toBeInTheDocument();
    expect(screen.queryByText(/^file:/)).not.toBeInTheDocument();
  });

  it('provides shared chart-focus context to the first-class prediction route', async () => {
    window.history.replaceState(null, '', '#/prediction?prediction=p_test');

    render(<AppRoot />);

    expect(await screen.findByText('prediction:p_test')).toBeInTheDocument();
    expect(screen.getByText('view:prediction')).toBeInTheDocument();
  });
});
