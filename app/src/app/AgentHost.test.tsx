import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Location, Navigate } from '../location';
import { resetSessionControllers } from '../session/controller';
import AgentHost from './AgentHost';

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
});

describe('AgentHost', () => {
  it('renders the exact Agent surface and replaces a draft only after starting its canonical turn', async () => {
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
    render(host(draft, navigate));

    await screen.findAllByText('GPT-6');
    fireEvent.change(screen.getByRole('textbox', { name: 'Continue the conversation' }), {
      target: { value: 'inspect this result' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }));

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
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({
      sandbox: 'workspace-write',
      autonomous: true,
      agent_mode: 'orchestrated',
      codex_runtime: runtime,
    });
    const turn = requests.find(({ url }) => url.endsWith('/messages'));
    expect(JSON.parse(String(turn?.init?.body))).toMatchObject({
      text: 'inspect this result',
      autonomous_mode: true,
      agent_mode: 'orchestrated',
      analyzer_context: { protocol: 'vibesim.conversation-context/v2' },
    });
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
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation history' }));
    await screen.findByText('New conversation');

    releaseOld();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Old conversation')).not.toBeInTheDocument();
    expect(screen.getByText('New conversation')).toBeInTheDocument();
  });
});
