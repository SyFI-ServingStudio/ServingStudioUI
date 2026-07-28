import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../../store';
import AgentPane from './AgentWorkspace';

const conversation = {
  id: 'c_test',
  title: 'Test',
  messages: [
    { role: 'user', content: 'Compare TP choices.' },
    {
      role: 'assistant',
      content: 'Inspect `exp.tp2.rate20.throughput`.',
      activity: [
        { kind: 'intermediate_output', role: 'orchestrator', text: 'Plan the comparison.' },
        { kind: 'usage', role: 'orchestrator', duration_ms: 10, tokens: {} },
        { kind: 'decision', action: 'delegate', task: 'Compare the coordinates.' },
        { kind: 'intermediate_output', role: 'implementer', text: 'Read the sweep.' },
        { kind: 'usage', role: 'implementer', duration_ms: 10, tokens: {} },
        { kind: 'implementer', text: 'The evidence is ready.' },
        { kind: 'final', text: 'Inspect `exp.tp2.rate20.throughput`.' },
      ],
      citations: [
        {
          protocol: 'vibesim.citation/v1',
          token: 'exp.tp2.rate20.throughput',
          sourceStart: 8,
          sourceEnd: 35,
          displayLabel: 'TP=2 · rate=20 · Throughput',
          target: {
            protocol: 'vibesim.analyzer/v1',
            kind: 'aggregate',
            experimentId: 's_test',
            panelId: 'total_tps',
            metricKey: 'total_tps',
            runId: 'r_test',
            coordinates: { tensor_parallel: 2, request_rate: 20 },
          },
        },
      ],
    },
  ],
};

beforeEach(() => {
  window.sessionStorage.setItem('vibesim.conversation.id', 'c_test');
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/stream')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(conversation), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('AgentPane', () => {
  it('renders persisted roles, handoffs, and a frozen clickable citation', async () => {
    const user = userEvent.setup();
    const postMessage = vi.spyOn(window, 'postMessage');
    render(<AgentPane prompt="Compare TP choices." />);

    expect(await screen.findByText('Orchestrator')).toBeInTheDocument();
    expect(screen.getByText('Implementer')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Orchestrator to Implementer')).toBeInTheDocument();
    expect(screen.getByText('Implementer to Orchestrator')).toBeInTheDocument();

    expect(postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /TP=2 · rate=20 · Throughput/ }));
    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'navigate',
      target: { kind: 'aggregate', runId: 'r_test' },
    });
  });

  it('exposes fold and full-page controls in the pane header', async () => {
    const user = userEvent.setup();
    const onFold = vi.fn();
    const onToggleFull = vi.fn();
    render(<AgentPane prompt="Inspect the sweep." onFold={onFold} onToggleFull={onToggleFull} />);

    await user.click(screen.getByRole('button', { name: 'Expand Agent to full page' }));
    await user.click(screen.getByRole('button', { name: 'Fold Agent' }));

    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onFold).toHaveBeenCalledOnce();
  });

  it('shows the literal active Analyzer selection above the composer', async () => {
    act(() => {
      useViz.getState().setAggregateSelection({
        kind: 'aggregate',
        experimentId: 's_test',
        panelId: 'total_tps',
        metricKey: 'total_tps',
        coordinates: { request_rate: 20, tensor_parallel: 2 },
      });
    });
    const user = userEvent.setup();
    render(<AgentPane prompt="Inspect the sweep." showSelectionContext />);

    const context = screen.getByRole('status', { name: 'Active Analyzer selection' });
    expect(context).toHaveTextContent('aggregate');
    expect(context).toHaveTextContent('request_rate=20');
    await user.click(screen.getByRole('button', { name: 'view JSON' }));
    expect(context).toHaveTextContent('"experimentId": "s_test"');
  });

  it('renders a legacy runtime exception as a compact retry card', async () => {
    const rawError =
      "(backend error: Command '['docker', 'run', '-d'] failed: no space left on device)";
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/stream')) return new Response(null, { status: 204 });
        return new Response(
          JSON.stringify({
            id: 'c_test',
            title: 'Test',
            messages: [{ role: 'assistant', content: rawError }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    render(<AgentPane prompt="Explain this graph." />);

    expect(await screen.findByText('Agent unavailable')).toBeInTheDocument();
    expect(screen.getByText(/host disk is full/)).toBeInTheDocument();
    expect(screen.queryByText(/docker.*run/)).not.toBeInTheDocument();
  });

  it('creates one conversation and sends the first prompt under StrictMode', async () => {
    window.sessionStorage.removeItem('vibesim.conversation.id');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/conversations' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'c_new', title: 'New chat', messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/messages') && init?.method === 'POST') {
        return new Response(
          [
            'event: done',
            'data: {"text":"Agent answer.","citations":[],"failure":null}',
            '',
            '',
          ].join('\n'),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'c_new',
          title: 'New chat',
          messages: [
            { role: 'user', content: 'Run a simulation.' },
            {
              role: 'assistant',
              content: 'Agent answer.',
              activity: [{ kind: 'final', text: 'Agent answer.' }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <AgentPane prompt="Run a simulation." />
      </StrictMode>,
    );

    expect(await screen.findByText('Agent answer.')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) => String(input) === '/api/conversations' && init?.method === 'POST',
        ),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) => String(input).endsWith('/messages') && init?.method === 'POST',
        ),
      ).toHaveLength(1);
    });
  });
});
