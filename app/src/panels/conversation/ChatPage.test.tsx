/**
 * Creating a conversation is a round trip, and the composer that started it can
 * be showing something else by the time it answers.
 *
 * The dock stays mounted while the reader moves between results, so an unmount
 * check is not enough: the component is alive, and it is a different draft.
 * These tests hold the create open and move the draft underneath it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationId, WorkspaceId } from '../../location';
import { resetSessionControllers } from '../../session/controller';
import { Chat } from './ChatPage';

let open: () => void;
let created: Promise<void>;
let posted: string[];
let requests: { url: string; init?: RequestInit }[];
/** The signal of the turn's own connection, for asserting it was let go of. */
let turnSignal: AbortSignal | undefined;
/** Overrides the message POST, for the cases that are about its timing. */
let postMessages: ((init?: RequestInit) => Promise<Response>) | null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  posted = [];
  requests = [];
  turnSignal = undefined;
  postMessages = null;
  open = () => {};
  created = new Promise<void>((resolve) => {
    open = resolve;
  });
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    posted.push(url);
    requests.push({ url, init });
    if (url.endsWith('/conversations') && init?.method === 'POST') {
      await created;
      return json({ id: 'c_new', title: 'New', updated_at: 1 });
    }
    if (url.endsWith('/messages')) {
      turnSignal = init?.signal ?? undefined;
      if (postMessages !== null) return postMessages(init);
      return new Response(new ReadableStream(), { status: 200 });
    }
    return json({ id: 'c_new', messages: [] });
  });
});

afterEach(() => {
  resetSessionControllers();
  vi.unstubAllGlobals();
});

/** A turn's stream, so a test can put something recognisable on it. */
function feed(): {
  stream: ReadableStream<Uint8Array>;
  push: (kind: string, data: unknown) => void;
} {
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      sink = controller;
    },
  });
  return {
    stream,
    push: (kind, data) => {
      try {
        sink?.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        // Writing to a connection the browser has dropped is what a server
        // does; what the browser does with it is nothing, which is the point.
      }
    },
  };
}

/** A promise a test can hold shut, then open, to place a response in time. */
function gate(): { opened: Promise<void>; open: () => void } {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function draft(workspace: WorkspaceId, onCreated: (id: ConversationId) => void) {
  return <Chat chat={{ state: 'draft', workspace }} onCreated={onCreated} />;
}

function atConversation(workspace: WorkspaceId, id: string) {
  return (
    <Chat chat={{ state: 'created', workspace, id: id as ConversationId }} onCreated={vi.fn()} />
  );
}

function send(text: string): void {
  fireEvent.change(screen.getByTestId('composer'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('send'));
}

describe('moving between conversations', () => {
  it('does not carry an unsent question into the next transcript', async () => {
    // The dock keeps one component across a change of conversation. Half a
    // question typed against one conversation and then sent into another is
    // the kind of mistake a reader cannot undo.
    const opened = (id: string) => (
      <Chat
        chat={{ state: 'created', workspace: 'w_main' as WorkspaceId, id: id as ConversationId }}
        onCreated={vi.fn()}
      />
    );
    const view = render(opened('c1'));
    await settle();
    fireEvent.change(screen.getByTestId('composer'), { target: { value: 'half a thought' } });

    view.rerender(opened('c2'));
    await settle();
    expect(screen.getByTestId('composer')).toHaveValue('');
  });
});

describe('a draft that is answered late', () => {
  it('pins the selected runtime and Agent settings on creation and the first turn', async () => {
    const runtime = {
      orchestrator: { model: 'o', effort: 'high', serviceTier: 'fast' as const },
      implementer: { model: 'i', effort: 'medium', serviceTier: 'default' as const },
      assistant: { model: 'a', effort: 'low', serviceTier: 'default' as const },
    };
    render(
      <Chat
        chat={{ state: 'draft', workspace: 'w_main' as WorkspaceId }}
        onCreated={vi.fn()}
        startOptions={{
          create: {
            codexRuntime: runtime,
            agentSettings: { agentMode: 'single', autonomous: false, sandbox: 'read-only' },
          },
          turn: { analyzer_context: { protocol: 'vibesim.conversation-context/v2' } },
        }}
      />,
    );
    send('inspect this result');
    open();
    await settle();

    const create = requests.find(({ url }) => url.endsWith('/conversations'));
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      sandbox: 'read-only',
      autonomous: false,
      agent_mode: 'single',
      codex_runtime: runtime,
    });
    const turn = requests.find(({ url }) => url.endsWith('/messages'));
    expect(JSON.parse(String(turn?.init?.body))).toEqual({
      analyzer_context: { protocol: 'vibesim.conversation-context/v2' },
      agent_mode: 'single',
      autonomous_mode: false,
      sandbox_mode: 'read-only',
      text: 'inspect this result',
    });
  });

  it('reports the new conversation to where the reader is now', async () => {
    // The reader moved to another result while the create was in flight. The
    // callback captured when Send was pressed would put them back.
    const before = vi.fn();
    const after = vi.fn();
    const view = render(draft('w_main' as WorkspaceId, before));
    send('why is attn slow?');
    await settle();
    view.rerender(draft('w_main' as WorkspaceId, after));
    open();
    await settle();
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith('c_new');
  });

  it('reports nothing when the draft has moved to another workspace', async () => {
    // A conversation created in one workspace is not an answer for a draft in
    // another; the id would name something the new address cannot open.
    // One callback across both renders, so that what is being tested is the
    // workspace check and not which closure was captured.
    const report = vi.fn();
    const view = render(draft('w_main' as WorkspaceId, report));
    send('why is attn slow?');
    await settle();
    view.rerender(draft('w_other' as WorkspaceId, report));
    open();
    await settle();
    expect(report).not.toHaveBeenCalled();
  });

  it('leaves the new workspace’s composer usable', async () => {
    // The draft that was waiting for an id is not this one. Carrying its
    // pending state across left the composer disabled with nothing on its way,
    // and no way back except reloading the page.
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    await settle();
    expect(screen.getByTestId('composer')).toBeDisabled();

    view.rerender(draft('w_other' as WorkspaceId, vi.fn()));
    expect(screen.getByTestId('composer')).toBeEnabled();
    open();
    await settle();
  });

  it('does not destroy the message it is still sending', async () => {
    // Letting go of an abandoned draft must not abort the send itself. The
    // request may not have reached the backend, and what the reader finds on
    // coming back is then an empty conversation with no account of where their
    // question went. Once accepted the turn is the server's, and the socket
    // can go.
    const accepted = gate();
    let signal: AbortSignal | undefined;
    postMessages = async (init) => {
      signal = init?.signal ?? undefined;
      await accepted.opened;
      return new Response(new ReadableStream(), { status: 200 });
    };
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    open();
    await settle();

    view.unmount();
    await settle();
    expect(signal?.aborted).toBe(false);

    accepted.open();
    await settle();
    expect(signal?.aborted).toBe(true);
  });

  it('lets go of a draft nothing took over', async () => {
    // Sending attaches, so that the panel on the new address finds a session
    // already running rather than loading history over it. When no panel
    // arrives — the reader closed the dock, or navigated elsewhere — nobody is
    // left holding that connection, and it would stay open with no watcher.
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    open();
    await settle();
    expect(turnSignal?.aborted).toBe(false);

    view.unmount();
    await settle();
    expect(turnSignal?.aborted).toBe(true);
  });

  it('lets go of a draft the reader left before the backend answered', async () => {
    // The other order: gone while the create was still in flight, so the
    // cleanup ran before there was anything to clean up. Whatever comes back
    // has to be released where it arrives.
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    view.unmount();
    open();
    await settle();
    expect(turnSignal?.aborted).toBe(true);
  });

  it('keeps the first message running while the draft becomes a conversation', async () => {
    // The point of the handover. The draft sends, the address changes, and the
    // panel that arrives has to find that turn still running — not an empty
    // history it loads over the top, losing everything the turn has said so
    // far. Nothing may drop the connection in between, and the draft that
    // opened it is exactly the thing that goes away.
    const turn = feed();
    postMessages = () => Promise.resolve(new Response(turn.stream, { status: 200 }));
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    open();
    await settle();
    turn.push('tool_call', { text: 'reading kernel timings' });
    await settle();

    view.rerender(atConversation('w_main' as WorkspaceId, 'c_new'));
    await settle();
    expect(turnSignal?.aborted).toBe(false);
    // What the turn had already said is still on screen. Counting requests
    // would not show this: a panel that dropped the connection and reloaded an
    // empty transcript makes no second POST either, and the reader would be
    // looking at a blank conversation with a turn running behind it.
    expect(screen.getByText('reading kernel timings')).toBeInTheDocument();
    expect(posted.filter((url) => url.endsWith('/messages'))).toHaveLength(1);
    // Unmounted here rather than left to the automatic cleanup: this is the one
    // case that leaves a session attached on purpose, and letting it run on
    // into the next test makes that test depend on what this one left behind.
    view.unmount();
  });

  it('lets go once the reader has moved to another conversation', async () => {
    // The other half: held for the conversation it was opened for, and no
    // longer. Held past that, every conversation a reader passed through on
    // their way would still be listening.
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    open();
    await settle();

    view.rerender(atConversation('w_main' as WorkspaceId, 'c_other'));
    await settle();
    expect(turnSignal?.aborted).toBe(true);
  });

  it('lets go when the workspace changes under the same conversation id', async () => {
    // A session is a `(workspace, conversation)` pair, and a lease that
    // remembered only the id would see this address as unchanged — holding a
    // connection open to a session nothing on screen is showing.
    const view = render(draft('w_main' as WorkspaceId, vi.fn()));
    send('why is attn slow?');
    open();
    await settle();

    view.rerender(atConversation('w_other' as WorkspaceId, 'c_new'));
    await settle();
    expect(turnSignal?.aborted).toBe(true);
  });
});
