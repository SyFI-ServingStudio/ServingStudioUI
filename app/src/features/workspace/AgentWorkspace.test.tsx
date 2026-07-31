import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../../store';
import AgentPane, { ConversationTranscript } from './AgentWorkspace';

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
  it('keeps a long transcript outside the per-keystroke draft render path', async () => {
    let contentReads = 0;
    const transcriptMessages = Array.from({ length: 80 }, (_, index) => {
      const message = { role: index % 2 === 0 ? 'user' : 'assistant' } as {
        role: string;
        content: string;
      };
      Object.defineProperty(message, 'content', {
        enumerable: true,
        get: () => {
          contentReads += 1;
          return `Message ${index}`;
        },
      });
      return message;
    });
    const liveEvents = [] as const;
    const loadEarlier = vi.fn();
    function Harness() {
      const [draft, setDraft] = useState('');
      return (
        <>
          <ConversationTranscript
            workspaceId="w_main"
            messages={transcriptMessages}
            messageStartIndex={0}
            liveEvents={liveEvents}
            progress=""
            streaming={false}
            error={null}
            canLoadEarlier={false}
            loadingEarlier={false}
            onLoadEarlier={loadEarlier}
          />
          <input
            aria-label="Draft performance probe"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const initialContentReads = contentReads;
    await user.type(screen.getByRole('textbox', { name: 'Draft performance probe' }), 'abcdefghij');

    expect(contentReads).toBe(initialContentReads);
  });

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
    const onClose = vi.fn();
    render(
      <AgentPane
        prompt="Inspect the sweep."
        onFold={onFold}
        onToggleFull={onToggleFull}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand Agent to full page' }));
    await user.click(screen.getByRole('button', { name: 'Fold Agent' }));
    await user.click(screen.getByRole('button', { name: 'Return to workspace home' }));

    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onFold).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
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

  it('loads every earlier message page instead of truncating a long migrated history', async () => {
    const latestPage = {
      id: 'c_test',
      title: 'Long migrated history',
      messages: [
        { role: 'user', content: 'Latest question.' },
        {
          role: 'assistant',
          content: 'Latest answer.',
          activity: [{ kind: 'final', text: 'Latest answer.' }],
        },
      ],
      message_page: {
        start_index: 2,
        end_index: 4,
        total_messages: 4,
        has_more: true,
      },
    };
    const earlierPage = {
      id: 'c_test',
      title: 'Long migrated history',
      messages: [
        { role: 'user', content: 'First question.' },
        {
          role: 'assistant',
          content: 'First answer.',
          activity: [{ kind: 'final', text: 'First answer.' }],
        },
      ],
      message_page: {
        start_index: 0,
        end_index: 2,
        total_messages: 4,
        has_more: false,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/conversations')) {
        return new Response(JSON.stringify({ conversations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const payload = url.includes('before=2') ? earlierPage : latestPage;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AgentPane prompt="" />);

    const latestAnswer = await screen.findByText('Latest answer.');
    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    expect(await screen.findByText('First answer.')).toBeInTheDocument();
    expect(screen.getByText('Latest answer.').isSameNode(latestAnswer)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w_main/conversations/c_test?limit=100&before=2',
    );
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

  it('renders local Markdown images through the active workspace file route', async () => {
    window.sessionStorage.setItem('vibesim.conversation.id.w_legacy_plot', 'c_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/stream')) return new Response(null, { status: 204 });
        return new Response(
          JSON.stringify({
            id: 'c_test',
            title: 'Plot',
            messages: [
              {
                role: 'assistant',
                content: '![Selected throughput](/workspace/logs/sweep/plots/throughput.png)',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    render(<AgentPane workspaceId="w_legacy_plot" prompt="" />);

    const image = await screen.findByRole('img', { name: 'Selected throughput' });
    expect(image).toHaveAttribute(
      'src',
      '/api/file?path=%2Fworkspace%2Flogs%2Fsweep%2Fplots%2Fthroughput.png&workspace_id=w_legacy_plot',
    );
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

    await waitFor(() => {
      expect(screen.getByText('Agent answer.')).toBeInTheDocument();
    });
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

  it('refreshes generated names without reinstalling the message timeline', async () => {
    let turnSent = false;
    let postTurnConversationReads = 0;
    const onWorkspaceNameChange = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/messages') && init?.method === 'POST') {
        turnSent = true;
        return new Response(
          [
            'event: done',
            'data: {"text":"Named answer.","citations":[],"failure":null,"naming_scheduled":true}',
            '',
            '',
          ].join('\n'),
          { status: 200 },
        );
      }
      if (url === '/api/workspaces/w_main') {
        return new Response(
          JSON.stringify({
            workspace_id: 'w_main',
            display_name: 'Llama Capacity Study',
            naming_state: 'generated',
            state: 'active',
            storage_kind: 'external',
            created_at: 1,
            last_accessed_at: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/workspaces/w_main/conversations') {
        return new Response(
          JSON.stringify({
            conversations: [
              {
                id: 'c_test',
                title: turnSent ? 'SLO Goodput Boundary' : 'Test',
                naming_state: turnSent ? 'generated' : 'pending',
                updated_at: 2,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/conversations/c_test?')) {
        if (turnSent) postTurnConversationReads += 1;
        const generated = turnSent && postTurnConversationReads >= 2;
        return new Response(
          JSON.stringify({
            id: 'c_test',
            title: generated ? 'SLO Goodput Boundary' : 'Test',
            naming_state: generated ? 'generated' : 'pending',
            messages: turnSent
              ? [
                  { role: 'user', content: 'Name this analysis.' },
                  {
                    role: 'assistant',
                    content: 'Named answer.',
                    activity: [{ kind: 'final', text: 'Named answer.' }],
                  },
                ]
              : conversation.messages,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <AgentPane
        full
        prompt=""
        workspaceName="Fallback workspace"
        onWorkspaceNameChange={onWorkspaceNameChange}
      />,
    );

    await user.type(await screen.findByPlaceholderText('Ask a follow-up'), 'Name this analysis.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
    const answerNode = await screen.findByText('Named answer.');

    await waitFor(
      () => {
        expect(onWorkspaceNameChange).toHaveBeenCalledWith('Llama Capacity Study');
        expect(screen.getByText(/SLO Goodput Boundary/)).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
    expect(screen.getByText('Named answer.').isSameNode(answerNode)).toBe(true);
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/messages') && init?.method === 'POST') {
        return new Response(stream, { status: 200 });
      }
      if (url.endsWith('/cancel') && init?.method === 'POST') {
        return new Response(JSON.stringify({ cancelled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'c_test', title: 'Test', messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
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

    await user.click(screen.getByRole('button', { name: 'Interrupt turn' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/w_main/conversations/c_test/cancel', {
        method: 'POST',
      });
      expect(screen.getByRole('button', { name: 'Send follow-up' })).toBeInTheDocument();
    });
  });
});
