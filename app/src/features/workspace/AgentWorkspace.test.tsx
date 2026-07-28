import { act, render, screen, waitFor, within } from '@testing-library/react';
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
        {
          kind: 'intermediate_output',
          role: 'orchestrator',
          text: 'Plan the **comparison**.',
        },
        { kind: 'usage', role: 'orchestrator', duration_ms: 10, tokens: {} },
        { kind: 'decision', action: 'delegate', task: 'Compare the **coordinates**.' },
        { kind: 'intermediate_output', role: 'implementer', text: 'Read the sweep.' },
        { kind: 'usage', role: 'implementer', duration_ms: 10, tokens: {} },
        { kind: 'implementer', text: 'The evidence is ready.' },
        { kind: 'final', text: 'Inspect `exp.tp2.rate20.throughput`.' },
      ],
      citations: [
        {
          protocol: 'vibesim.citation/v2',
          token: 'exp.tp2.rate20.throughput',
          sourceStart: 8,
          sourceEnd: 35,
          displayLabel: 'TP=2 · rate=20 · Throughput',
          target: {
            protocol: 'vibesim.analyzer/v2',
            kind: 'aggregate',
            workspaceId: 'w_main',
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
  window.sessionStorage.setItem('vibesim.conversation.id.w_main', 'c_test');
  window.localStorage.clear();
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
    expect(screen.getByRole('region', { name: 'Delegated task' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Implementation report' })).toBeInTheDocument();
    expect(screen.getByText('comparison').tagName).toBe('STRONG');
    expect(screen.getByText('coordinates').tagName).toBe('STRONG');

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

  it('restores searchable history and switches conversations without a dropdown', async () => {
    const olderConversation = {
      id: 'c_older',
      title: 'H200 goodput boundary',
      messages: [
        { role: 'user', content: 'Find the goodput boundary.' },
        {
          role: 'assistant',
          content: 'The saved answer.',
          activity: [{ kind: 'final', text: 'The saved answer.' }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/workspaces/w_main/conversations') {
          return new Response(
            JSON.stringify({
              conversations: [
                { id: 'c_test', title: 'TP comparison', updated_at: 1785254400 },
                {
                  id: 'c_older',
                  title: 'H200 goodput boundary',
                  updated_at: 1785168000,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('/c_older?')) {
          return new Response(JSON.stringify(olderConversation), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/stream')) return new Response(null, { status: 204 });
        return new Response(JSON.stringify(conversation), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const user = userEvent.setup();
    render(<AgentPane full prompt="" />);

    await user.click(await screen.findByRole('button', { name: 'Open conversation history' }));
    const history = screen.getByRole('region', { name: 'Conversation history' });
    expect(history).toBeInTheDocument();
    expect(screen.getByText('2 saved')).toBeInTheDocument();

    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await user.type(search, 'goodput');
    expect(within(history).queryByText('TP comparison')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open H200 goodput boundary' }));

    expect(await screen.findByText('The saved answer.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('vibesim.conversation.id.w_main')).toBe('c_older');
    expect(screen.queryByRole('region', { name: 'Conversation history' })).not.toBeInTheDocument();
  });

  it('pins conversation history as a persistent left rail and restores the preference', async () => {
    const user = userEvent.setup();
    const firstRender = render(<AgentPane full prompt="" />);

    await user.click(await screen.findByRole('button', { name: 'Open conversation history' }));
    await user.click(screen.getByRole('button', { name: 'Pin conversation history to the left' }));

    expect(screen.getByRole('region', { name: 'Conversation history' })).toHaveAttribute(
      'data-history-mode',
      'persistent',
    );
    expect(window.localStorage.getItem('vibesim.conversation.history.pinned')).toBe('true');

    firstRender.unmount();
    render(<AgentPane full prompt="" />);

    expect(screen.getByRole('region', { name: 'Conversation history' })).toHaveAttribute(
      'data-history-mode',
      'persistent',
    );
    await user.click(screen.getByRole('button', { name: 'Hide conversation history' }));
    expect(screen.queryByRole('region', { name: 'Conversation history' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('vibesim.conversation.history.pinned')).toBeNull();
  });

  it('keeps the follow-up composer on the same reading column as answers', async () => {
    render(<AgentPane full prompt="" />);

    await screen.findByText('Answer');
    expect(screen.getByTestId('agent-message-column')).toHaveStyle({
      width: 'min(720px,calc(100% - 40px))',
    });
    expect(screen.getByTestId('agent-composer-column')).toHaveStyle({
      width: 'min(720px,calc(100% - 40px))',
    });
  });

  it('shows the literal active Analyzer selection above the composer', async () => {
    act(() => {
      useViz.getState().setAggregateSelection({
        kind: 'aggregate',
        workspaceId: 'w_main',
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
    window.sessionStorage.removeItem('vibesim.conversation.id.w_main');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/workspaces/w_main/conversations' && init?.method === 'POST') {
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
          ([input, init]) =>
            String(input) === '/api/workspaces/w_main/conversations' && init?.method === 'POST',
        ),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) => String(input).endsWith('/messages') && init?.method === 'POST',
        ),
      ).toHaveLength(1);
    });
  });

  it('does not create a conversation until the user sends the first prompt', async () => {
    window.sessionStorage.removeItem('vibesim.conversation.id.w_main');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <AgentPane full prompt="" />
      </StrictMode>,
    );

    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    });
  });

  it('surfaces a live MCP call as tool activity', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'event: intermediate_output',
              'data: {"role":"orchestrator","text":"I will inspect the analyzer."}',
              '',
              'event: progress',
              'data: {"text":"tool: read_analyzer_resource"}',
              '',
              '',
            ].join('\n'),
          ),
        );
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/stream')) return new Response(null, { status: 204 });
        if (url.endsWith('/messages') && init?.method === 'POST') {
          return new Response(stream, { status: 200 });
        }
        return new Response(JSON.stringify({ id: 'c_test', title: 'Test', messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const user = userEvent.setup();
    render(<AgentPane prompt="" />);

    const composer = await screen.findByRole('textbox');
    await user.type(composer, 'Inspect the sweep.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

    expect(
      await screen.findByRole('status', {
        name: 'tool call: read_analyzer_resource',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('tool call')).toBeInTheDocument();
    expect(screen.getByText('read_analyzer_resource')).toBeInTheDocument();
  });
});
