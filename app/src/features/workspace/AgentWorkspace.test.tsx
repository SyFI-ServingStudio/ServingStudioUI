import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../../store';
import AgentPane, { ConversationTranscript } from './AgentWorkspace';
import { useWorkspaceUi } from './workspaceUiStore';

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
  it('renders a clarification request as an input-needed terminal state', () => {
    render(
      <ConversationTranscript
        workspaceId="w_main"
        messages={[
          {
            role: 'assistant',
            content: 'Which GPU should I use?',
            activity: [
              {
                kind: 'final',
                text: 'Which GPU should I use?',
                outcome: 'request_user_input',
              },
            ],
          },
        ]}
        messageStartIndex={0}
        liveEvents={[]}
        toolCall=""
        streaming={false}
        error={null}
        canLoadEarlier={false}
        loadingEarlier={false}
        onLoadEarlier={() => undefined}
      />,
    );

    expect(screen.getByText('Input needed')).toBeInTheDocument();
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.queryByText('Answer')).not.toBeInTheDocument();
  });

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
            toolCall=""
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
    useWorkspaceUi.getState().setAgentPanelMode('full');
    render(<AgentPane prompt="Compare TP choices." />);

    // Scoped to the transcript: the composer labels its backend tablets with the
    // same role words.
    const transcript = within(await screen.findByTestId('agent-message-column'));
    expect(transcript.getByText('Orchestrator')).toBeInTheDocument();
    expect(transcript.getByText('Implementer')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Orchestrator to Implementer')).toBeInTheDocument();
    expect(screen.getByText('Implementer to Orchestrator')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Delegated task' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Implementation report' })).toBeInTheDocument();
    expect(screen.getByText('comparison').tagName).toBe('STRONG');
    expect(screen.getByText('coordinates').tagName).toBe('STRONG');

    expect(postMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /TP=2 · rate=20 · Throughput/ }));
    expect(useWorkspaceUi.getState().agentPanelMode).toBe('docked');
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
    render(<AgentPane prompt="" onFold={onFold} onToggleFull={onToggleFull} onClose={onClose} />);

    const expandRuntime = screen.getByRole('button', { name: 'Expand model controls' });
    expect(expandRuntime).toHaveAttribute('aria-expanded', 'false');
    await user.click(expandRuntime);
    expect(screen.getByRole('button', { name: 'Collapse model controls' })).toHaveAttribute(
      'aria-expanded',
      'true',
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

  it('switches conversations without cancelling an active backend turn', async () => {
    const runningConversation = {
      id: 'c_test',
      title: 'Running sweep',
      messages: [{ role: 'user', content: 'Run the sweep.' }],
    };
    const savedConversation = {
      id: 'c_saved',
      title: 'Saved analysis',
      messages: [
        { role: 'user', content: 'Explain the result.' },
        {
          role: 'assistant',
          content: 'Saved answer remains readable.',
          activity: [{ kind: 'final', text: 'Saved answer remains readable.' }],
        },
      ],
    };
    let liveStreamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/codex-backends') {
        return new Response(
          JSON.stringify({
            backends: [{ id: 'traditional', label: 'Traditional', model: '', available: true }],
            defaults: { orchestrator: 'traditional', implementer: 'traditional' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/workspaces/w_main/conversations') {
        return new Response(
          JSON.stringify({
            conversations: [
              { id: 'c_test', title: 'Running sweep', updated_at: 2 },
              { id: 'c_saved', title: 'Saved analysis', updated_at: 1 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/c_saved?')) {
        return new Response(JSON.stringify(savedConversation), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/c_saved/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/c_test/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/c_test/messages') && init?.method === 'POST') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            liveStreamController = controller;
            controller.enqueue(
              new TextEncoder().encode('event: tool_call\ndata: {"text":"simulation running"}\n\n'),
            );
          },
        });
        init.signal?.addEventListener('abort', () => {
          liveStreamController?.error(new DOMException('Detached from stream', 'AbortError'));
        });
        return new Response(stream, { status: 200 });
      }
      if (url.includes('/c_test?')) {
        return new Response(JSON.stringify(runningConversation), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AgentPane full prompt="" />);

    await user.type(await screen.findByRole('textbox'), 'Continue profiling.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
    expect(await screen.findByText('simulation running')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open conversation history' }));
    const savedRow = screen.getByRole('button', { name: 'Open Saved analysis' });
    expect(savedRow).toBeEnabled();
    await user.click(savedRow);

    expect(await screen.findByText('Saved answer remains readable.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('vibesim.conversation.id.w_main')).toBe('c_saved');
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith('/cancel') && init?.method === 'POST',
      ),
    ).toBe(false);
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
    const runtimePicker = screen.getByTestId('agent-runtime-picker');
    const composer = screen.getByTestId('agent-composer-column');
    expect(screen.getByTestId('agent-message-column')).toHaveStyle({
      width: 'min(720px,calc(100% - 40px))',
    });
    expect(composer).toHaveStyle({
      width: 'min(720px,calc(100% - 40px))',
    });
    expect(composer).toContainElement(runtimePicker);
  });

  it('clears the active Analyzer attachment from the next Agent turn', async () => {
    const selection = {
      kind: 'aggregate' as const,
      workspaceId: 'w_main',
      experimentId: 's_test',
      panelId: 'total_tps',
      metricKey: 'total_tps',
      coordinates: { request_rate: 20, tensor_parallel: 2 },
    };
    act(() => {
      useViz.getState().setAggregateSelection(selection);
    });
    const fetchMock = vi.mocked(fetch);
    const user = userEvent.setup();
    render(
      <AgentPane
        prompt=""
        showSelectionContext
        analyzerContext={{
          protocol: 'vibesim.conversation-context/v2',
          selection,
          citationDictionary: {
            protocol: 'vibesim.citation-dictionary/v2',
            identity: 'aggregate-s_test',
            document: 'Analyzer context for the selected sweep.',
            entries: [],
          },
        }}
      />,
    );

    const context = screen.getByRole('status', { name: 'Active Analyzer selection' });
    const runtimePicker = screen.getByTestId('agent-runtime-picker');
    expect(runtimePicker.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(context).toHaveTextContent('aggregate');
    expect(context).toHaveTextContent('request_rate=20');
    await user.click(screen.getByRole('button', { name: 'view JSON' }));
    expect(context).toHaveTextContent('"experimentId": "s_test"');
    await user.click(screen.getByRole('button', { name: 'Clear Analyzer context' }));
    expect(
      screen.queryByRole('status', { name: 'Active Analyzer selection' }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Ask a follow-up'), 'Compare without context.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).endsWith('/messages') && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    const messageRequest = fetchMock.mock.calls.find(([input, init]) => {
      if (!String(input).endsWith('/messages') || init?.method !== 'POST') return false;
      return JSON.parse(String(init.body)).text === 'Compare without context.';
    });
    expect(messageRequest).toBeDefined();
    expect(JSON.parse(String(messageRequest?.[1]?.body))).not.toHaveProperty('analyzerContext');
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
              'event: tool_call',
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

describe('file references in Agent output', () => {
  function renderAnswer(text: string) {
    return render(
      <ConversationTranscript
        workspaceId="w_main"
        messages={[
          {
            role: 'assistant',
            content: text,
            activity: [{ kind: 'final', text }],
          },
        ]}
        messageStartIndex={0}
        liveEvents={[]}
        toolCall=""
        streaming={false}
        error={null}
        canLoadEarlier={false}
        loadingEarlier={false}
        onLoadEarlier={() => undefined}
      />,
    );
  }

  it('opens a relative Markdown link in the preview pane instead of a new tab', async () => {
    renderAnswer('See [the summary](logs/20260728_test/summary.json).');

    const link = screen.getByRole('button', { name: 'the summary' });
    await userEvent.setup().click(link);

    expect(window.location.hash).toBe(
      '#/file?workspace=w_main&path=logs%2F20260728_test%2Fsummary.json',
    );
  });

  it('treats a container-absolute path as a workspace file, not a site URL', () => {
    renderAnswer('See [the log](/workspace/logs/run.log).');

    expect(screen.getByRole('button', { name: 'the log' })).toHaveAttribute(
      'title',
      '/workspace/logs/run.log',
    );
  });

  it('keeps a real URL an external link', () => {
    renderAnswer('See [the docs](https://docs.vllm.ai/).');

    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://docs.vllm.ai/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links a backticked path and carries its line number', async () => {
    renderAnswer('Fixed in `simulator/src/worker/mod.rs:42`.');

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'simulator/src/worker/mod.rs:42' }));

    expect(window.location.hash).toBe(
      '#/file?workspace=w_main&path=simulator%2Fsrc%2Fworker%2Fmod.rs&line=42',
    );
  });

  it('leaves a path-shaped phrase that is not a path as plain code', () => {
    renderAnswer('Throughput is reported in `tokens/s` per `p50/p99` bucket.');

    expect(screen.queryByRole('button', { name: 'tokens/s' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'p50/p99' })).not.toBeInTheDocument();
    expect(screen.getByText('tokens/s')).toBeInTheDocument();
  });

  it('serves a relative image through the workspace file route', () => {
    renderAnswer('![throughput](logs/plots/throughput.png)');

    expect(screen.getByAltText('throughput')).toHaveAttribute(
      'src',
      '/api/file?path=logs%2Fplots%2Fthroughput.png&workspace_id=w_main',
    );
  });
});
