import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { catalogReads, navigate, resolveEvidenceMock } = vi.hoisted(() => ({
  catalogReads: [] as unknown[],
  navigate: vi.fn(),
  resolveEvidenceMock: vi.fn(),
}));

vi.mock('./commit', () => ({ commit: navigate }));
vi.mock('../artifacts', async (importOriginal) => {
  const original = await importOriginal();
  return { ...(original as object), useArtifacts: () => catalogReads };
});
vi.mock('./evidence', async (importOriginal) => {
  const original = await importOriginal();
  return { ...(original as object), resolveEvidence: resolveEvidenceMock };
});
vi.mock('./AgentHost', () => ({
  default: ({
    location,
    selectionContext,
    onClearSelectionContext,
    onToggleFull,
    renderMarkdown,
    visible,
  }: {
    location: { view: string };
    selectionContext: { values: readonly string[] } | null;
    onClearSelectionContext: () => void;
    onToggleFull?: () => void;
    renderMarkdown: (
      text: string,
      citations: readonly unknown[],
      workspace: string,
      compact: boolean,
    ) => React.ReactNode;
    visible?: boolean;
  }) => (
    <aside
      data-testid="canonical-agent"
      data-location-view={location.view}
      data-visible={String(visible)}
    >
      <span>{selectionContext?.values.join('|') ?? 'no selection'}</span>
      <button type="button" onClick={onClearSelectionContext}>
        Clear selection
      </button>
      <button type="button" onClick={onToggleFull}>
        Toggle full
      </button>
      {renderMarkdown(
        '`first` and `second`',
        [
          {
            token: 'run.cluster.first',
            sourceStart: 0,
            sourceEnd: 7,
            displayLabel: 'First evidence',
            target: { id: 'first' },
          },
          {
            token: 'run.cluster.second',
            sourceStart: 12,
            sourceEnd: 20,
            displayLabel: 'Second evidence',
            target: { id: 'second' },
          },
        ],
        'w_main',
        false,
      )}
    </aside>
  ),
}));

vi.mock('../panels/catalog/CatalogPage', () => ({
  CatalogPage: () => <main>catalog content</main>,
}));

import { EMPTY_FOCUS, type Location } from '../location';
import { LocatedApp } from './App';

const CHAT = { state: 'created', workspace: 'w_main', id: 'c_one' } as const;

function run(id: string): Location {
  return {
    view: 'result',
    ref: { kind: 'run', id, workspace: 'w_main' },
    focus: {
      ...EMPTY_FOCUS,
      panel: 'retired.panel',
      path: [
        { at: 'pool', role: 'decode' },
        { at: 'worker', id: '3' },
      ],
    },
    chat: CHAT,
  };
}

beforeEach(() => {
  navigate.mockClear();
  resolveEvidenceMock.mockReset();
  catalogReads.splice(0);
});

describe('LocatedApp shell assembly', () => {
  it('keeps the canonical Agent node mounted across result changes and full mode', () => {
    const { rerender } = render(<LocatedApp location={run('20260901_1_first')} />);
    const agent = screen.getByTestId('canonical-agent');
    expect(screen.getByText('run|retired.panel|worker|pool=decode|worker=decode/3')).toBeVisible();

    rerender(<LocatedApp location={run('20260901_2_second')} />);
    expect(screen.getByTestId('canonical-agent').isSameNode(agent)).toBe(true);

    rerender(<LocatedApp location={{ view: 'chat', chat: CHAT }} />);
    expect(screen.getByTestId('canonical-agent').isSameNode(agent)).toBe(true);
    expect(screen.getByTestId('canonical-agent')).toHaveAttribute('data-location-view', 'chat');
  });

  it('keeps the Agent DOM mounted while passing folded visibility through', () => {
    render(<LocatedApp location={run('20260901_1_first')} />);
    const agent = screen.getByTestId('canonical-agent');
    expect(agent).toHaveAttribute('data-visible', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Fold Agent' }));
    expect(screen.getByTestId('canonical-agent').isSameNode(agent)).toBe(true);
    expect(agent).toHaveAttribute('data-visible', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open Agent' }));
    expect(screen.getByTestId('canonical-agent').isSameNode(agent)).toBe(true);
    expect(agent).toHaveAttribute('data-visible', 'true');
  });

  it('matches the legacy Analyzer fallback while a run has no parent sweep', () => {
    render(<LocatedApp location={run('20260901_1_first')} />);
    expect(screen.getByText('Analyzer')).toBeVisible();
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('opens the original new-conversation setup from the catalog', () => {
    render(
      <LocatedApp
        location={{
          view: 'catalog',
          filter: { workspace: 'w_main', kinds: [], query: null },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'New conversation' }));
    expect(screen.getByRole('radiogroup', { name: 'Agent working style' })).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clears only the current Agent context while leaving the result visible', () => {
    render(<LocatedApp location={run('20260901_1_first')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(screen.getByText('no selection')).toBeVisible();
    expect(screen.getByText(/This build has no panel called/)).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets only the latest evidence request update status and navigate', async () => {
    let finishFirst!: (value: unknown) => void;
    let finishSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => (finishFirst = resolve));
    const second = new Promise((resolve) => (finishSecond = resolve));
    resolveEvidenceMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    render(<LocatedApp location={run('20260901_1_first')} />);

    fireEvent.click(screen.getByRole('button', { name: /First evidence/ }));
    const firstSignal = resolveEvidenceMock.mock.calls[0]?.[2] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: /Second evidence/ }));
    expect(firstSignal.aborted).toBe(true);

    const destination = run('resolved');
    await act(async () => finishSecond({ status: 'ok', location: destination }));
    await act(async () => finishFirst({ status: 'ok', location: run('stale') }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(destination, 'push');
  });

  it('aborts evidence resolution when the addressed Location changes', async () => {
    let finish!: (value: unknown) => void;
    resolveEvidenceMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const view = render(<LocatedApp location={run('20260901_1_first')} />);
    fireEvent.click(screen.getByRole('button', { name: /First evidence/ }));
    const signal = resolveEvidenceMock.mock.calls[0]?.[2] as AbortSignal;

    view.rerender(<LocatedApp location={run('20260901_2_second')} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ status: 'ok', location: run('stale') }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reproduces the sweep header from canonical catalog metadata', () => {
    catalogReads.push({
      status: 'ready',
      schemaVersion: 1,
      revision: 'catalog-1',
      value: [
        {
          kind: 'sweep',
          id: 's_one',
          workspace: 'w_main',
          displayName: '20260901_2_tp_rate',
          status: 'ready',
          updatedAt: '2026-09-01T00:00:00Z',
          numRuns: 6,
          deployments: ['unified'],
          traces: ['aime.csv'],
          axes: ['tensor_parallel', 'request_rate'],
        },
      ],
    });
    render(
      <LocatedApp
        location={{
          view: 'result',
          ref: { kind: 'sweep', id: 's_one', workspace: 'w_main' },
          focus: EMPTY_FOCUS,
          chat: null,
        }}
      />,
    );

    expect(screen.getByText('tp_rate')).toBeVisible();
    expect(screen.getByText('6 runs')).toBeVisible();
    for (const label of ['unified', 'aime.csv', 'tensor_parallel', 'request_rate']) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });
});
