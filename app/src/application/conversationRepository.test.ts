import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AnalyzerTurnContextV2 } from '../domain/citation';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listAllConversations,
  listConversations,
  resumeConversationTurn,
  sendConversationTurn,
  updateConversationRuntime,
} from './conversationRepository';

const context: AnalyzerTurnContextV2 = {
  protocol: 'vibesim.conversation-context/v2',
  selection: { kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_test' },
  citationDictionary: {
    protocol: 'vibesim.citation-dictionary/v2',
    identity: 'dictionary-1',
    document: 'Use `exp.throughput`.',
    entries: [
      {
        token: 'exp.throughput',
        displayLabel: 'Total throughput',
        target: {
          protocol: 'vibesim.analyzer/v2',
          kind: 'aggregate',
          workspaceId: 'w_main',
          experimentId: 's_test',
          panelId: 'total_tps',
          metricKey: 'total_tps',
        },
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('conversation repository', () => {
  it('persists role-specific Codex runtimes on create and on runtime updates', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: 'c_new',
            title: 'New conversation',
            naming_state: 'manual',
            codex_runtime: {
              orchestrator: {
                model: 'gpt-5.6-terra',
                effort: 'high',
                serviceTier: 'fast',
              },
              implementer: {
                model: 'gpt-5.6-sol',
                effort: 'xhigh',
                serviceTier: 'default',
              },
              assistant: {
                model: 'gpt-5.6-sol',
                effort: 'xhigh',
                serviceTier: 'fast',
              },
            },
            messages: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const selection = {
      orchestrator: { model: 'gpt-5.6-terra', effort: 'high', serviceTier: 'fast' },
      implementer: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
      assistant: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'fast' },
    } as const;

    await createConversation('w_main', selection, {
      agentMode: 'single',
      autonomous: false,
    });
    await updateConversationRuntime('w_main', 'c_new', selection);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/workspaces/w_main/conversations');
    // Both agent axes ride the create body: the backend pins them there, and a
    // conversation started from this UI must not silently inherit a default.
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      codex_runtime: selection,
      agent_mode: 'single',
      autonomous: false,
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/workspaces/w_main/conversations/c_new/runtime',
      expect.objectContaining({ method: 'PATCH' }),
    ]);
  });

  it('lists and deletes saved conversations through the shared browser API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('{}', { status: 200 });
      return new Response(
        JSON.stringify({
          conversations: [
            { id: 'c_recent', title: 'Recent sweep', updated_at: 1785254400 },
            { id: 'c_older', title: 'Older sweep', updated_at: 1785168000 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listConversations('w_main')).resolves.toHaveLength(2);
    await deleteConversation('w_main', 'c_older');

    expect(fetchMock).toHaveBeenLastCalledWith('/api/workspaces/w_main/conversations/c_older', {
      method: 'DELETE',
    });
  });

  it('lists conversations across workspaces for the Page 0 resume picker', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: 'c_recent',
                workspace_id: 'w_kernel',
                title: 'Kernel study',
                naming_state: 'generated',
                updated_at: 1785254400,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAllConversations()).resolves.toEqual([
      {
        id: 'c_recent',
        workspaceId: 'w_kernel',
        title: 'Kernel study',
        naming_state: 'generated',
        updated_at: 1785254400,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations');
  });

  it('requests an earlier message page with the backend cursor', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'c_long',
            title: 'Long history',
            messages: [{ role: 'user', content: 'older' }],
            message_page: {
              start_index: 0,
              end_index: 22,
              total_messages: 122,
              has_more: false,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const conversation = await getConversation('w_main', 'c_long', 22);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w_main/conversations/c_long?limit=100&before=22',
    );
    expect(conversation?.message_page?.start_index).toBe(0);
  });

  it('sends the bounded Analyzer context and decodes live events plus frozen citations', async () => {
    const citation = {
      protocol: 'vibesim.citation/v2',
      token: 'exp.throughput',
      sourceStart: 4,
      sourceEnd: 20,
      displayLabel: 'Total throughput',
      target: context.citationDictionary.entries[0]!.target,
    };
    const stream = [
      'event: intermediate_output',
      'data: {"role":"orchestrator","backend":"codexds","text":"Inspecting."}',
      '',
      'event: done',
      `data: ${JSON.stringify({
        text: 'See `exp.throughput`.',
        citations: [citation],
        citation_dictionary_id: 'dictionary-1',
        citation_dsl_version: 'v2',
      })}`,
      '',
      '',
    ].join('\n');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(stream, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];
    const completions: unknown[] = [];

    await sendConversationTurn(
      'w_main',
      'c_test',
      'Compare throughput.',
      context,
      { agentMode: 'single', autonomous: false },
      {
        event: (event) => events.push(event),
        done: (completion) => completions.push(completion),
      },
      new AbortController().signal,
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      text: 'Compare throughput.',
      analyzerContext: context,
      // Sent every turn, not just the first: the backend ignores it once the
      // conversation has history, and the caller should not have to know which
      // turn is the first one.
      agent_mode: 'single',
      autonomous_mode: false,
    });
    expect(events).toContainEqual({
      kind: 'intermediate_output',
      role: 'orchestrator',
      level: 'progress',
      text: 'Inspecting.',
    });
    expect(events).toContainEqual({
      kind: 'final',
      text: 'See `exp.throughput`.',
      outcome: 'final_answer',
    });
    expect(completions).toContainEqual({
      text: 'See `exp.throughput`.',
      outcome: 'final_answer',
      citations: [citation],
      citationDictionaryId: 'dictionary-1',
      citationDslVersion: 'v2',
      failure: null,
      namingScheduled: false,
      interruptedRole: '',
    });
  });

  it('treats an idle resume as a normal 204 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(
      resumeConversationTurn('w_main', 'c_idle', {}, new AbortController().signal),
    ).resolves.toBe(false);
  });

  it('decodes a structured runtime failure as an error event, not an answer', async () => {
    const failure = {
      code: 'runtime_storage_full',
      message:
        'The Agent runtime could not start because the host disk is full. Free space, then retry this question.',
    };
    const stream = [
      'event: done',
      `data: ${JSON.stringify({ text: failure.message, failure })}`,
      '',
      '',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const events: unknown[] = [];
    const completions: unknown[] = [];

    await sendConversationTurn(
      'w_main',
      'c_test',
      'Explain this graph.',
      null,
      { agentMode: 'orchestrated', autonomous: true },
      {
        event: (event) => events.push(event),
        done: (completion) => completions.push(completion),
      },
      new AbortController().signal,
    );

    expect(events).toEqual([{ kind: 'error', text: failure.message }]);
    expect(completions).toContainEqual({
      text: failure.message,
      outcome: 'final_answer',
      citations: [],
      citationDictionaryId: null,
      citationDslVersion: null,
      failure,
      namingScheduled: false,
      interruptedRole: '',
    });
  });

  it('normalizes a legacy raw backend error without exposing its command', async () => {
    const rawError =
      "(backend error: Command '['docker', 'run', '-d'] failed: no space left on device)";
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'c_legacy',
              title: 'Legacy',
              messages: [{ role: 'assistant', content: rawError }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    const conversation = await getConversation('w_main', 'c_legacy');

    expect(conversation?.messages[0]?.failure).toEqual({
      code: 'runtime_storage_full',
      message:
        'The Agent runtime could not start because the host disk is full. Free space, then retry this question.',
    });
    expect(conversation?.messages[0]?.failure?.message).not.toContain('docker');
  });

  it('adapts legacy role output and intermediate notes without changing stored data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'c_legacy',
              title: 'Legacy',
              messages: [
                {
                  role: 'assistant',
                  content:
                    '<details class="role-output orchestrator">raw</details>\n\n' +
                    '### Message\n\nRendered answer.',
                  intermediate_outputs: [{ role: 'orchestrator', text: 'Inspecting the sweep.' }],
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    const conversation = await getConversation('w_main', 'c_legacy');

    expect(conversation?.messages[0]).toMatchObject({
      content: 'Rendered answer.',
      activity: [
        {
          kind: 'intermediate_output',
          role: 'orchestrator',
          text: 'Inspecting the sweep.',
        },
        { kind: 'final', text: 'Rendered answer.', outcome: 'final_answer' },
      ],
    });
  });

  it('preserves a clarification outcome as a distinct terminal event', async () => {
    const stream = [
      'event: done',
      'data: {"text":"Which GPU should I use?","outcome":"request_user_input"}',
      '',
      '',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const events: unknown[] = [];
    const completions: unknown[] = [];

    await sendConversationTurn(
      'w_main',
      'c_test',
      'Run a prediction.',
      null,
      { agentMode: 'orchestrated', autonomous: true },
      {
        event: (event) => events.push(event),
        done: (completion) => completions.push(completion),
      },
      new AbortController().signal,
    );

    expect(events).toEqual([
      {
        kind: 'final',
        text: 'Which GPU should I use?',
        outcome: 'request_user_input',
      },
    ]);
    expect(completions).toContainEqual(
      expect.objectContaining({
        text: 'Which GPU should I use?',
        outcome: 'request_user_input',
      }),
    );
  });
});
