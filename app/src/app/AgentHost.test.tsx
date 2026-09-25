import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Location, Navigate } from '../location';
import { resetSessionControllers, sessionController } from '../session/controller';
import AgentHost from './AgentHost';
import { storeEntryDraft } from './entryDraft';

const draft: Location = {
  view: 'chat',
  chat: { state: 'draft', workspace: 'w_main' },
};

const runtime = {
  orchestrator: { model: 'gpt-6', effort: 'high', serviceTier: 'default' as const },
  implementer: { model: 'gpt-6', effort: 'high', serviceTier: 'default' as const },
  assistant: { model: 'gpt-6', effort: 'high', serviceTier: 'default' as const },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function catalog() {
  return {
    models: [
      {
        id: 'gpt-6',
        label: 'GPT-6',
        family: 'gpt',
        familyLabel: 'GPT',
        efforts: ['high'],
        defaultEffort: 'high',
        serviceTiers: ['default'],
        defaultServiceTier: 'default',
        available: true,
      },
    ],
    defaults: runtime,
  };
}

function host(location: Location, navigate: Navigate, visible = true) {
  return (
    <AgentHost
      location={location}
      navigate={navigate}
      selectionContext={null}
      analyzerContext={{ protocol: 'vibesim.conversation-context/v2' }}
      onClearSelectionContext={() => undefined}
      renderMarkdown={(text) => text}
      onOpenManagedResult={() => undefined}
      visible={visible}
      full
    />
  );
}

afterEach(() => {
  resetSessionControllers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('AgentHost', () => {
  it('restores the saved provider and locks history to it despite duplicate model IDs', async () => {
    const saved = { ...runtime, assistant: { ...runtime.assistant, provider: 'personal' } };
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(String(input), 'http://fixture').pathname;
      if (url.endsWith('/codex-backends'))
        return json({
          defaults: runtime,
          models: ['work', 'personal'].map((family) => ({
            ...catalog().models[0],
            family,
            familyLabel: family,
          })),
        });
      if (url.endsWith('/workspaces/w_main'))
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      if (url.endsWith('/conversations')) return json({ conversations: [] });
      if (url.endsWith('/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/c_provider'))
        return json({
          id: 'c_provider',
          agent_mode: 'single',
          autonomous: false,
          codex_runtime: saved,
          messages: [{ id: 1, role: 'user', content: 'Saved connection' }],
        });
      throw new Error(`unexpected request: ${url}`);
    });
    render(
      host(
        { view: 'chat', chat: { state: 'created', workspace: 'w_main', id: 'c_provider' } },
        vi.fn<Navigate>(),
      ),
    );
    await screen.findByText('Saved connection');
    fireEvent.click(await screen.findByLabelText('Assistant Agent runtime'));
    const options = screen.getAllByRole('radio', { name: 'GPT-6 at high' });
    expect(options[0]).toBeDisabled();
    expect(options[0]).not.toBeChecked();
    expect(options[1]).not.toBeDisabled();
    expect(options[1]).toBeChecked();
  });

  it.each([
    { visibleAnchor: false, userScrolled: false },
    { visibleAnchor: true, userScrolled: false },
    { visibleAnchor: true, userScrolled: true },
  ])(
    'preserves paging position and respects input (anchor: $visibleAnchor, user scrolled: $userScrolled)',
    async ({ visibleAnchor, userScrolled }) => {
      let release = () => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let height = 2000;
      vi.stubGlobal('fetch', async (input: string) => {
        const url = new URL(String(input), 'http://fixture');
        if (url.pathname.endsWith('/codex-backends')) return json(catalog());
        if (url.pathname.endsWith('/workspaces/w_main')) {
          return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
        }
        if (url.pathname.endsWith('/conversations')) return json({ conversations: [] });
        if (url.pathname.endsWith('/stream')) return new Response(null, { status: 204 });
        if (url.pathname.endsWith('/c_paged')) {
          const older = url.searchParams.has('before');
          if (older) await pending;
          return json({
            id: 'c_paged',
            agent_mode: 'single',
            sandbox: 'read-only',
            autonomous: false,
            codex_runtime: runtime,
            messages: [{ id: older ? 1 : 2, role: 'user', content: older ? 'Earlier' : 'Current' }],
            message_page: {
              start_index: older ? 0 : 1,
              end_index: older ? 1 : 2,
              total_messages: 2,
              has_more: !older,
            },
          });
        }
        throw new Error(`unexpected request: ${url}`);
      });
      render(
        host(
          { view: 'chat', chat: { state: 'created', workspace: 'w_main', id: 'c_paged' } },
          vi.fn<Navigate>(),
        ),
      );
      await screen.findByRole('button', { name: 'Load earlier messages' });
      const column = screen.getByTestId('agent-message-column');
      Object.defineProperty(column, 'scrollHeight', { configurable: true, get: () => height });
      column.scrollTop = 100;
      if (visibleAnchor) {
        const anchor = column.querySelector<HTMLElement>('[data-outline-block="t1"]')!;
        // New content above adds 400px while unrelated content below adds another 200px.
        vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(
          () => new DOMRect(0, (height === 2000 ? 340 : 740) - column.scrollTop, 100, 50),
        );
      }
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
      await screen.findByRole('button', { name: 'Loading earlier…' });
      expect(column.scrollTop).toBe(100);
      if (userScrolled) {
        fireEvent.wheel(column);
        column.scrollTop = 225;
      }
      await act(async () => {
        height = 2600;
        release();
        await pending;
      });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Loading earlier…' })).not.toBeInTheDocument(),
      );
      expect(column.scrollTop).toBe(userScrolled ? 225 : visibleAnchor ? 500 : 700);
    },
  );

  it('restores cached settings under StrictMode and reconnects after visibility changes', async () => {
    const ref = { workspace: 'w_main', conversation: 'c_cached' };
    let reads = 0;
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname.endsWith('/codex-backends')) return json(catalog());
      if (url.pathname.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.pathname.endsWith('/conversations')) return json({ conversations: [] });
      if (url.pathname.endsWith('/stream')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/c_cached')) {
        reads += 1;
        return json({
          id: ref.conversation,
          sandbox: 'read-only',
          agent_mode: 'single',
          autonomous: false,
          codex_runtime: runtime,
          messages: [{ id: 1, role: 'user', content: 'Stored history' }],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const controller = sessionController(ref);
    const release = controller.observe();
    await waitFor(() => expect(controller.getState().agentSettings?.sandbox).toBe('read-only'));
    release();
    const location: Location = {
      view: 'chat',
      chat: { state: 'created', workspace: 'w_main', id: 'c_cached' },
    };
    const navigate = vi.fn<Navigate>();
    const view = render(<StrictMode>{host(location, navigate)}</StrictMode>);
    await screen.findByText('Stored history');
    expect(screen.getByText('single')).toBeInTheDocument();
    expect(screen.getByText('human')).toBeInTheDocument();
    expect(controller.getState().agentSettings?.sandbox).toBe('read-only');

    const before = reads;
    view.rerender(<StrictMode>{host(location, navigate, false)}</StrictMode>);
    view.rerender(<StrictMode>{host(location, navigate, true)}</StrictMode>);
    await waitFor(() => expect(reads).toBeGreaterThan(before));
    await waitFor(() => expect(controller.getState().status).toBe('idle'));
    expect(controller.getState().agentSettings?.sandbox).toBe('read-only');
  });

  it('submits an entry-page draft exactly once before replacing it with its canonical turn', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/codex-backends')) {
        return json(catalog());
      }
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations') && init?.method === 'POST') {
        return json({ id: 'c_new', title: 'New conversation', updated_at: 1 });
      }
      if (url.endsWith('/conversations')) return json({ conversations: [] });
      if (url.endsWith('/messages')) {
        return new Response(new ReadableStream(), {
          headers: { 'content-type': 'text/event-stream', 'x-vibesim-turn-id': 'turn-1' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const navigate = vi.fn<Navigate>();
    storeEntryDraft({
      workspace: 'w_main',
      prompt: 'inspect this result',
      runtime,
    });
    render(<StrictMode>{host(draft, navigate)}</StrictMode>);

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(
      {
        view: 'chat',
        chat: { state: 'created', workspace: 'w_main', id: 'c_new' },
      },
      'replace',
    );
    const create = requests.find(
      ({ url, init }) => url.endsWith('/conversations') && init?.method === 'POST',
    );
    expect(
      requests.filter(({ url, init }) => url.endsWith('/conversations') && init?.method === 'POST'),
    ).toHaveLength(1);
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({
      sandbox: 'workspace-write',
      autonomous: true,
      agent_mode: 'orchestrated',
      codex_runtime: runtime,
    });
    const turn = requests.find(({ url }) => url.endsWith('/messages'));
    expect(requests.filter(({ url }) => url.endsWith('/messages'))).toHaveLength(1);
    expect(JSON.parse(String(turn?.init?.body))).toMatchObject({
      text: 'inspect this result',
      autonomous_mode: true,
      sandbox_mode: 'workspace-write',
      agent_mode: 'orchestrated',
      analyzer_context: { protocol: 'vibesim.conversation-context/v2' },
    });
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('locks the composer without exposing fake Stop or Queue actions during creation', async () => {
    let finishCreate = () => {};
    const creating = new Promise<void>((resolve) => {
      finishCreate = resolve;
    });
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations') && init?.method === 'POST') {
        await creating;
        return json({ id: 'c_new', title: 'New conversation' });
      }
      if (url.endsWith('/conversations')) return json({ conversations: [] });
      if (url.endsWith('/messages')) return new Response(new ReadableStream());
      throw new Error(`unexpected request: ${url}`);
    });
    const navigate = vi.fn<Navigate>();
    render(host(draft, navigate));
    await screen.findAllByText('GPT-6');
    const input = screen.getByRole('textbox', { name: 'Continue the conversation' });
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send follow-up' })).toBeDisabled(),
    );

    expect(input).toBeDisabled();
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Interrupt|Queue/ })).not.toBeInTheDocument();

    finishCreate();
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });

  it('releases a late draft turn instead of reopening Agent after the reader left', async () => {
    let finishCreate = () => {};
    const creating = new Promise<void>((resolve) => {
      finishCreate = resolve;
    });
    let turnSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations') && init?.method === 'POST') {
        await creating;
        return json({ id: 'c_new', title: 'New conversation' });
      }
      if (url.endsWith('/conversations')) return json({ conversations: [] });
      if (url.endsWith('/messages')) {
        turnSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream());
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const navigate = vi.fn<Navigate>();
    const view = render(host(draft, navigate));
    await screen.findAllByText('GPT-6');
    fireEvent.change(screen.getByRole('textbox', { name: 'Continue the conversation' }), {
      target: { value: 'start and leave' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }));
    view.rerender(
      host(
        {
          view: 'catalog',
          filter: { workspace: 'w_main', kinds: [], query: null },
        },
        navigate,
      ),
    );

    finishCreate();
    await waitFor(() => expect(turnSignal?.aborted).toBe(true));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('releases a draft bridge lease when creation finishes while the Agent is folded', async () => {
    let finishCreate = () => {};
    const creating = new Promise<void>((resolve) => {
      finishCreate = resolve;
    });
    let turnSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations') && init?.method === 'POST') {
        await creating;
        return json({ id: 'c_new', title: 'New conversation' });
      }
      if (url.endsWith('/conversations')) return json({ conversations: [] });
      if (url.endsWith('/messages')) {
        turnSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream());
      }
      if (url.endsWith('/conversations/c_new')) return json({ id: 'c_new', messages: [] });
      if (url.endsWith('/conversations/c_new/stream')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const navigate = vi.fn<Navigate>();
    const view = render(host(draft, navigate));
    await screen.findAllByText('GPT-6');
    fireEvent.change(screen.getByRole('textbox', { name: 'Continue the conversation' }), {
      target: { value: 'start then fold' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }));
    view.rerender(host(draft, navigate, false));

    finishCreate();
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    view.rerender(
      host(
        { view: 'chat', chat: { state: 'created', workspace: 'w_main', id: 'c_new' } },
        navigate,
        false,
      ),
    );
    await waitFor(() => expect(turnSignal?.aborted).toBe(true));
  });

  it('preserves input while a failed session is unavailable and exposes Retry', async () => {
    let conversationReads = 0;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations')) {
        return json({ conversations: [{ id: 'c_one', title: 'One', updated_at: 1 }] });
      }
      if (url.endsWith('/conversations/c_one')) {
        conversationReads += 1;
        if (conversationReads === 1) {
          return new Response(JSON.stringify({ detail: 'failed' }), {
            status: 500,
            statusText: 'Internal Server Error',
          });
        }
        return json({ id: 'c_one', messages: [] });
      }
      if (url.endsWith('/conversations/c_one/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/messages') && init?.method === 'POST') {
        return new Response(new ReadableStream());
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const location: Location = {
      view: 'chat',
      chat: { state: 'created', workspace: 'w_main', id: 'c_one' },
    };
    render(host(location, vi.fn<Navigate>()));
    await screen.findByRole('button', { name: 'Retry conversation' });
    const input = screen.getByRole('textbox', { name: 'Continue the conversation' });
    fireEvent.change(input, { target: { value: 'do not lose this' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(input).toHaveValue('do not lose this');

    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry conversation' })).not.toBeInTheDocument(),
    );
    expect(input).toHaveValue('do not lose this');
  });

  it('queues a message typed during a turn and sends it once the turn completes', async () => {
    const encoder = new TextEncoder();
    let finish = () => {};
    const posts: string[] = [];
    let answered = false;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://fixture').pathname;
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations')) {
        return json({ conversations: [{ id: 'c_one', title: 'One', updated_at: 1 }] });
      }
      if (url.endsWith('/conversations/c_one')) {
        return json({
          id: 'c_one',
          agent_mode: 'single',
          sandbox: 'read-only',
          autonomous: false,
          codex_runtime: runtime,
          messages: answered
            ? [
                { id: 1, role: 'user', content: 'First question' },
                { id: 2, role: 'assistant', content: 'First answer' },
              ]
            : [],
        });
      }
      if (url.endsWith('/conversations/c_one/stream')) return new Response(null, { status: 204 });
      if (url.endsWith('/messages') && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)).text);
        if (posts.length > 1) return new Response(new ReadableStream());
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              finish = () => {
                answered = true;
                controller.enqueue(
                  encoder.encode('event: done\ndata: {"text":"First answer"}\n\n'),
                );
                controller.close();
              };
            },
          }),
          { headers: { 'content-type': 'text/event-stream', 'x-vibesim-turn-id': 'turn-1' } },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(
      host(
        { view: 'chat', chat: { state: 'created', workspace: 'w_main', id: 'c_one' } },
        vi.fn<Navigate>(),
      ),
    );
    const input = await screen.findByRole('textbox', { name: 'Continue the conversation' });
    fireEvent.change(input, { target: { value: 'First question' } });
    const send = screen.getByRole('button', { name: 'Send follow-up' });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() => expect(posts).toEqual(['First question']));

    fireEvent.change(input, { target: { value: 'Follow up' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Queue message' }));
    expect(await screen.findByRole('listitem', { name: 'Queued message 1 of 1' })).toBeVisible();
    expect(input).toHaveValue('');
    expect(posts).toEqual(['First question']);

    act(() => finish());
    await waitFor(() => expect(posts).toEqual(['First question', 'Follow up']));
    expect(screen.queryByRole('listitem', { name: /Queued message/ })).not.toBeInTheDocument();
  });

  it('never installs a late history response from the workspace that was left', async () => {
    let releaseOld = () => {};
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_old')) {
        return json({ workspace_id: 'w_old', display_name: 'Old', state: 'active' });
      }
      if (url.endsWith('/workspaces/w_new')) {
        return json({ workspace_id: 'w_new', display_name: 'New', state: 'active' });
      }
      if (url.endsWith('/workspaces/w_old/conversations')) {
        await oldGate;
        return json({ conversations: [{ id: 'c_old', title: 'Old conversation' }] });
      }
      if (url.endsWith('/workspaces/w_new/conversations')) {
        return json({ conversations: [{ id: 'c_new', title: 'New conversation' }] });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const navigate = vi.fn<Navigate>();
    const view = render(
      host({ view: 'chat', chat: { state: 'draft', workspace: 'w_old' } }, navigate),
    );
    view.rerender(host({ view: 'chat', chat: { state: 'draft', workspace: 'w_new' } }, navigate));
    // The full page pins history by default, so it is already on screen.
    await screen.findByText('New conversation');

    releaseOld();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Old conversation')).not.toBeInTheDocument();
    expect(screen.getByText('New conversation')).toBeInTheDocument();
  });

  it('lists other workspaces, jumps into them, and saves a rename', async () => {
    const patches: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces')) {
        return json({
          workspaces: [
            { workspace_id: 'w_main', display_name: 'Main', state: 'active' },
            { workspace_id: 'w_other', display_name: 'Other study', state: 'active' },
            { workspace_id: 'w_gone', display_name: 'Archived', state: 'archived' },
          ],
        });
      }
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/workspaces/w_main/conversations')) {
        return json({ conversations: [{ id: 'c_here', title: 'Here', updated_at: 1 }] });
      }
      if (url.endsWith('/workspaces/w_other/conversations')) {
        return json({ conversations: [{ id: 'c_there', title: 'There', updated_at: 2 }] });
      }
      if (url.endsWith('/workspaces/w_other/conversations/c_there') && init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        return json({ id: 'c_there', title: 'Renamed', messages: [] });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const navigate = vi.fn<Navigate>();
    render(host(draft, navigate));

    const other = await screen.findByRole('region', { name: 'Workspace Other study' });
    expect(screen.queryByRole('region', { name: 'Workspace Archived' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open There' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        { view: 'chat', chat: { state: 'created', workspace: 'w_other', id: 'c_there' } },
        'push',
      ),
    );
    // Deletion stays with the workspace on screen.
    expect(screen.queryByRole('button', { name: 'Delete There' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename There' }));
    const field = screen.getByRole('textbox', { name: 'Rename There' });
    fireEvent.change(field, { target: { value: '  Renamed  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(other).toHaveTextContent('Renamed'));
    expect(patches).toEqual([
      {
        url: '/api/agent/v1/workspaces/w_other/conversations/c_there',
        body: { title: 'Renamed' },
      },
    ]);
  });

  it('keeps the old title when a rename is cancelled with Escape', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations')) {
        return json({ conversations: [{ id: 'c_here', title: 'Here', updated_at: 1 }] });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(host(draft, vi.fn<Navigate>()));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Here' }));
    const field = screen.getByRole('textbox', { name: 'Rename Here' });
    fireEvent.change(field, { target: { value: 'Discarded' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.blur(field);
    expect(screen.getByRole('button', { name: 'Open Here' })).toHaveTextContent('Here');
    expect(requests.filter((request) => request.startsWith('PATCH'))).toEqual([]);
  });

  it('shows a rename at once and puts the old title back if saving fails', async () => {
    let finishPatch: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/codex-backends')) return json(catalog());
      if (url.endsWith('/workspaces/w_main')) {
        return json({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
      }
      if (url.endsWith('/conversations')) {
        return json({ conversations: [{ id: 'c_here', title: 'Here', updated_at: 1 }] });
      }
      if (url.endsWith('/conversations/c_here') && init?.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          finishPatch = resolve;
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    render(host(draft, vi.fn<Navigate>()));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Here' }));
    const field = screen.getByRole('textbox', { name: 'Rename Here' });
    fireEvent.change(field, { target: { value: 'Elsewhere' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // Before the backend has answered.
    expect(await screen.findByRole('button', { name: 'Open Elsewhere' })).toBeInTheDocument();

    await act(async () => {
      finishPatch(
        new Response(JSON.stringify({ detail: 'failed' }), {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      );
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });
});
