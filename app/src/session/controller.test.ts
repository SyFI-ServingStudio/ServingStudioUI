/**
 * The controller's job is to be right about *when*, so these tests are about
 * ordering: what a late response may overwrite, what detaching does not stop,
 * and what a cancel is allowed to conclude before the server has confirmed it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSessionControllers, sessionController } from './controller';
import type { SessionRef, SessionState } from './types';

const REF: SessionRef = { workspace: 'w_main', conversation: 'c1' };
const BASE = '/api/agent/v1/workspaces/w_main/conversations/c1';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A stream a test can feed one event at a time. */
class Feed {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly stream: ReadableStream<Uint8Array>;
  private readonly encoder = new TextEncoder();
  /** True once the consumer's fetch was aborted. */
  broken = false;

  constructor() {
    this.stream = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  push(kind: string, data: Record<string, unknown>): void {
    this.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Raw bytes, for the frames a well-behaved backend would not send. */
  write(frame: string): void {
    try {
      this.controller?.enqueue(this.encoder.encode(frame));
    } catch {
      // Writing to a broken connection is what a server does when the browser
      // has gone; the test is about what the browser does with it, which is
      // nothing.
    }
  }

  close(): void {
    this.controller?.close();
  }

  /** End the body the way a dropped connection does: an error, not an EOF. */
  breakNow(): void {
    this.controller?.error(new TypeError('connection reset'));
  }

  /**
   * Behave like a real connection: aborting the fetch breaks the body.
   *
   * Without this a test can assert that `detach()` set a status while the
   * socket it was supposed to release stayed open.
   */
  breakOn(signal: AbortSignal | null | undefined): this {
    signal?.addEventListener('abort', () => {
      this.broken = true;
      this.controller?.error(new DOMException('aborted', 'AbortError'));
    });
    return this;
  }
}

/** A promise a test can hold shut, then open, to place a response in time. */
function gate(): { opened: Promise<void>; open: () => void } {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A conversation, spelled the way the backend spells one.
 *
 * `page(start, total)` builds the envelope rather than letting each test write
 * one: the field is `total_messages`, and a fixture that invented `total` would
 * pass a test the real service fails.
 */
function conversation(messages: readonly unknown[], page?: Record<string, unknown>): unknown {
  return { id: 'c1', messages, ...(page === undefined ? {} : { message_page: page }) };
}

function page(startIndex: number, count: number, total: number): Record<string, unknown> {
  return {
    start_index: startIndex,
    end_index: startIndex + count,
    total_messages: total,
    has_more: startIndex > 0,
  };
}

/**
 * Let everything already in flight land.
 *
 * Macrotasks, not just microtasks: reading a response body and pulling from a
 * stream both go through the platform, so flushing the microtask queue would
 * return before the controller has seen a single byte.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type Handler = (init?: RequestInit, url?: string) => Promise<Response> | Response;

let calls: Call[];
let routes: Map<string, Handler>;

function route(key: string, handler: Handler): void {
  routes.set(key, handler);
}

beforeEach(() => {
  calls = [];
  routes = new Map();
  route('GET /', () => json(conversation([])));
  route('GET /stream', () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    });
    const suffix = url.slice(BASE.length).split('?')[0];
    const handler = routes.get(`${method} ${suffix === '' ? '/' : suffix}`);
    if (handler === undefined) return Promise.resolve(json({ detail: 'no route' }, 404));
    return Promise.resolve(handler(init, url));
  });
});

afterEach(() => {
  resetSessionControllers();
  vi.unstubAllGlobals();
});

function states(): { current: () => SessionState; seen: SessionState[] } {
  const controller = sessionController(REF);
  const seen: SessionState[] = [];
  controller.subscribe(() => seen.push(controller.getState()));
  return { current: () => controller.getState(), seen };
}

describe('sessionController', () => {
  it('is one controller per conversation', () => {
    // Two panels showing the same conversation are two views of one session.
    expect(sessionController(REF)).toBe(sessionController({ ...REF }));
    expect(sessionController(REF)).not.toBe(sessionController({ ...REF, conversation: 'c2' }));
  });

  it('loads history on attach and stays idle when nothing is running', async () => {
    route('GET /', () =>
      json({
        id: 'c1',
        title: 'GPU analysis',
        naming_state: 'generated',
        codex_runtime: {
          orchestrator: { provider: 'work', model: 'gpt-6', effort: 'high', serviceTier: 'fast' },
          implementer: { model: 'gpt-6', effort: 'medium', serviceTier: 'default' },
          assistant: { model: 'gpt-6', effort: 'high', serviceTier: 'default' },
        },
        agent_mode: 'single',
        sandbox: 'read-only',
        autonomous: true,
        messages: [{ id: 1, role: 'user', content: 'hi' }],
      }),
    );
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().messages).toHaveLength(1);
    expect(controller.getState()).toMatchObject({
      title: 'GPU analysis',
      namingState: 'generated',
      codexRuntime: {
        orchestrator: { provider: 'work', model: 'gpt-6', effort: 'high', serviceTier: 'fast' },
      },
      agentSettings: { agentMode: 'single', autonomous: true, sandbox: 'read-only' },
    });
  });

  it('attaches once however many panels ask', async () => {
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    controller.attach();
    await settle();
    expect(calls.filter((call) => call.url.includes('?limit='))).toHaveLength(1);
  });

  it('reattaches to a turn that is already running', async () => {
    const feed = new Feed();
    route('GET /stream', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('streaming');
    feed.push('final', { text: 'half an answer' });
    await settle();
    expect(controller.getState().live).toHaveLength(1);
  });

  it('shows the user’s own message before the backend has confirmed it', async () => {
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    const { current } = states();
    void controller.send('what happened here?');
    // Not awaited on purpose: a composer that clears only after a round trip
    // feels broken on a slow link.
    expect(current().messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'what happened here?',
    });
    expect(current().status).toBe('streaming');
    await settle();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { text: 'what happened here?' } });
  });

  it('replaces the live turn with stored history when it ends', async () => {
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    route('GET /', () =>
      json(
        conversation([
          { id: 1, role: 'user', content: 'ask' },
          { id: 2, role: 'assistant', content: 'answered' },
        ]),
      ),
    );
    feed.push('done', { text: 'answered' });
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().live).toEqual([]);
    expect(controller.getState().messages.at(-1)).toMatchObject({ content: 'answered' });
  });

  it('calls the turn detached, not finished, when the stream stops without done', async () => {
    // The turn may still be running on the server; the difference is whether
    // reattaching would find anything.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('detached');
  });

  it('detach releases the connection and cancels nothing', async () => {
    const feed = new Feed();
    route(
      'GET /stream',
      (init) => new Response(feed.breakOn(init?.signal).stream, { status: 200 }),
    );
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    controller.detach();
    await settle();
    expect(controller.getState().status).toBe('detached');
    // Three parts of one claim: the request was aborted, nothing that arrives
    // afterwards is applied, and the turn itself was never cancelled.
    expect(feed.broken).toBe(true);
    feed.push('final', { text: 'produced after we stopped listening' });
    await settle();
    expect(controller.getState().live).toEqual([]);
    expect(calls.some((call) => call.url.endsWith('/cancel'))).toBe(false);
  });

  it('reattaches after a detach', async () => {
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    controller.detach();
    controller.attach();
    await settle();
    expect(calls.filter((call) => call.url.endsWith('/stream'))).toHaveLength(2);
  });

  it('does not offer the composer again while its own message is unanswered', async () => {
    // Closing a panel and reopening it in the moment after Send. The reload
    // asks the backend what is running and is told nothing is — true of what
    // the backend has read so far, and already out of date, because our own
    // message is still on its way there.
    //
    // Taking that answer at face value offers the composer for a conversation
    // that is about to have a turn. The second message then either loses a race
    // it should never have been in, or is dropped when the panel next closes,
    // and either way it is a question the reader typed and never sees answered.
    const held = gate();
    const turn = new Feed();
    route('POST /messages', async (init) => {
      await held.opened;
      return new Response(turn.breakOn(init?.signal).stream, { status: 200 });
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();

    controller.detach();
    controller.attach();
    await settle();

    // The session really does read idle here — that is the trap, not a bug.
    expect(controller.getState().status).toBe('idle');
    expect(controller.canSend()).toBe(false);
    // And the reader is told why, because everything else on the panel says
    // this conversation is free: an idle chip over a composer that will not
    // send is a bug report waiting to be filed.
    expect(controller.getState().error).toContain('has not acknowledged it yet');

    held.open();
    await settle();
    // The note comes down with the acknowledgement rather than outliving it.
    expect(controller.getState().error).toBeNull();
    expect(controller.canSend()).toBe(true);
  });

  it('an old connection failing does not hand a newer message to the abort', async () => {
    // An unacknowledged message must survive the panel closing, and which
    // message is unacknowledged is per-send. This is the sequence that loses
    // track of it: the first turn's socket outlives the panel that opened it,
    // fails long after a second message has gone out, and — if settling is not
    // tied to the send that is settling — announces that the *second* message
    // has been heard back about. Closing the panel then aborts a POST the
    // backend may never have seen, and the reader comes back to a conversation
    // with no record of what they asked.
    const stalled = new Feed();
    const accepted = new Feed();
    const held = gate();
    const signals: AbortSignal[] = [];
    let posted = 0;
    route('POST /messages', async (init) => {
      posted += 1;
      // Deliberately not wired to the signal: a body that keeps hanging after
      // the fetch is aborted is a stalled socket, and it is what makes the two
      // settlements land out of order.
      if (posted === 1) return new Response(stalled.stream, { status: 200 });
      signals.push(init?.signal as AbortSignal);
      await held.opened;
      return new Response(accepted.breakOn(init?.signal).stream, { status: 200 });
    });
    const controller = sessionController(REF);
    void controller.send('first');
    await settle();

    // The panel closes and reopens; the backend says nothing is running, which
    // is true — the first turn is over as far as it is concerned.
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('idle');

    void controller.send('second');
    await settle();
    expect(controller.canSend()).toBe(false);

    // Only now does the first connection error, having stopped mattering two
    // operations ago.
    stalled.breakNow();
    await settle();

    controller.detach();
    await settle();
    // The second message is still nobody's but this browser's, so letting go of
    // the connection waits rather than destroying it.
    expect(signals[0].aborted).toBe(false);

    held.open();
    await settle();
    // And once the backend has it, the socket really is released.
    expect(signals[0].aborted).toBe(true);
  });

  it('a Stop asked for before the message landed is not withdrawn by a reload', async () => {
    // The backend truthfully says it has nothing to stop, because the message
    // it would stop has not reached it yet. Reattaching in that window asks the
    // same question and gets the same true, useless answer — and treating it as
    // "the turn is over" throws away a Stop the reader is still waiting on. The
    // turn then runs to completion having been stopped.
    const held = gate();
    const turn = new Feed();
    route('POST /messages', async (init) => {
      await held.opened;
      return new Response(turn.breakOn(init?.signal).stream, { status: 200 });
    });
    route('POST /cancel', () => json({ cancelled: false }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();
    // Nothing has gone out yet: there is no turn to name, and an unnamed Stop
    // in this window would stop whatever *else* is running.
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(0);

    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('idle');

    held.open();
    await settle();
    // Asked now that there is something to stop — the reload in between did not
    // take the Stop away.
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('reattaches to the turn its own message started, when the reload missed it', async () => {
    // Same window, without a Stop. The reload was told nothing was running and
    // believed it; the message then lands and the turn begins. Returning
    // quietly here leaves the reader on an idle page, their question gone from
    // the composer and absent from the transcript, while the agent answers it.
    const held = gate();
    const live = new Feed();
    let resumed = 0;
    route('GET /stream', (init) => {
      resumed += 1;
      // The first reload really does find nothing; by the second, the message
      // has been accepted and the backend replays the turn it started.
      if (resumed === 1) return new Response(null, { status: 204 });
      return new Response(live.breakOn(init?.signal).stream, { status: 200 });
    });
    route('POST /messages', async (init) => {
      await held.opened;
      return new Response(new Feed().breakOn(init?.signal).stream, { status: 200 });
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('idle');

    held.open();
    await settle();
    expect(controller.getState().status).toBe('streaming');
    live.push('final', { text: 'the answer' });
    await settle();
    expect(controller.getState().live).toHaveLength(1);
  });

  it('says a message may have been lost, without claiming it was not sent', async () => {
    // The composer cleared when the message left, and the reload replaced the
    // transcript with what the backend has stored — which does not include it.
    // Without a word, the question is simply gone.
    //
    // But the word has to be honest. A response that never came back is not a
    // message that never arrived: the backend may have taken the turn and lost
    // the answer on the way home, and a reader told flatly that it was not sent
    // will send it again — a second copy of the same request landing on a
    // conversation already running the first.
    const held = gate();
    route('POST /messages', async () => {
      await held.opened;
      return json({ detail: 'gateway went away' }, 502);
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    controller.detach();
    controller.attach();
    await settle();

    const before = calls.length;
    held.open();
    await settle();
    expect(controller.getState().error).toContain('may not have reached the backend');
    expect(controller.getState().error).not.toContain('was not sent');
    // A note, not a status: the conversation itself was read without trouble,
    // and offering Retry for it would retry the wrong thing.
    expect(controller.getState().status).toBe('idle');
    // And the question gets asked rather than handed to the reader, who has no
    // button that asks it — Retry and Reattach belong to states this is not.
    // The composer reopens on the answer, over a conversation that now shows
    // whatever the backend actually kept.
    expect(calls.slice(before).map((call) => call.url.split('/').pop())).toContain('stream');
    expect(controller.canSend()).toBe(true);
  });

  it('reopens the composer once the conversation has been read again', async () => {
    // The escape from the state above. The reader is told to reload, and a
    // reload does reopen it — but the flag is *set* by a branch that only runs
    // when a reload has already happened, so the routes that follow are the
    // ones that have to clear it. Here the reattached stream is reading the
    // very turn that message started: it ends, the history is refetched, and
    // the message the reader was unsure about is on screen. Leaving the
    // composer shut then is a session that never sends again.
    const held = gate();
    const live = new Feed();
    // Always live: the reattach finds a turn already running, so when the POST
    // finally fails the session is `streaming` — which is the one state that
    // cannot ask the question for itself, because asking means dropping the
    // stream the reader is watching. The turn's own ending is what answers it.
    route(
      'GET /stream',
      (init) => new Response(live.breakOn(init?.signal).stream, { status: 200 }),
    );
    route('POST /messages', async () => {
      await held.opened;
      return json({ detail: 'gateway went away' }, 502);
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('streaming');

    held.open();
    await settle();
    // The POST's answer never came back, so this browser does not know — and
    // does not interrupt a running turn to find out.
    expect(controller.getState().status).toBe('streaming');
    expect(controller.canSend()).toBe(false);

    // And then the turn it could not confirm finishes, and the refetch that
    // follows brings back a conversation the reader can look at.
    live.push('done', {});
    live.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.canSend()).toBe(true);
  });

  it('does not settle a message in doubt with a read that predates it', async () => {
    // The other way out of that state, and the one that has to be earned. A
    // read can come back after the message left while having been *asked for*
    // before it: the backend answers it from the conversation as it stood then,
    // which is a conversation with no sign of the message and nothing running.
    //
    // Taken as the answer, it is the worst page this session can produce: an
    // idle chip and a live composer over a turn that is being answered right
    // now, never subscribed to, with the reader invited to ask again on top of
    // it. What settles the question is a read that postdates the message —
    // the backend stores it and registers its turn before it answers the send,
    // so a request sent afterwards cannot miss both.
    const posted = gate();
    const history = gate();
    const turn = new Feed();
    let resumed = 0;
    route('GET /stream', (init) => {
      resumed += 1;
      // The first reconnect really does find nothing: the message that becomes
      // this turn is still on its way. By the second, the backend has it.
      if (resumed === 1) return new Response(null, { status: 204 });
      return new Response(turn.breakOn(init?.signal).stream, { status: 200 });
    });
    route('GET /', async () => {
      await history.opened;
      return json(conversation([]));
    });
    route('POST /messages', async () => {
      await posted.opened;
      return json({ detail: 'gateway went away' }, 502);
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    controller.detach();
    controller.attach();
    await settle();

    // The POST's answer is lost while that history read is still in flight, so
    // the backend may be answering the message and this browser cannot tell.
    posted.open();
    await settle();
    // And only now does the read from before come back.
    history.open();
    await settle();

    expect(resumed).toBe(2);
    expect(controller.getState().status).toBe('streaming');
    expect(controller.canSend()).toBe(false);
    turn.push('final', { text: 'answering the message it could not confirm' });
    await settle();
    expect(controller.getState().live).toHaveLength(1);
  });

  it('does not hold a reattached stream open behind an unrelated message', async () => {
    // `release` waits for an unanswered POST rather than aborting it. That is
    // about *that* socket: a read this browser opened has nothing to lose by
    // being dropped, and holding one per reattach leaks a subscription each
    // time.
    const held = gate();
    const resumedTurn = new Feed();
    route(
      'GET /stream',
      (init) =>
        new Response(resumedTurn.breakOn(init?.signal).stream, {
          status: 200,
        }),
    );
    route('POST /messages', async (init) => {
      await held.opened;
      return new Response(new Feed().breakOn(init?.signal).stream, { status: 200 });
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();

    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('streaming');

    controller.detach();
    await settle();
    expect(resumedTurn.broken).toBe(true);

    held.open();
    await settle();
  });

  it('does not stop someone else’s turn when its own message never ran', async () => {
    // The Stop retry exists for one race: the reader pressed Stop while their
    // own message was still being accepted, so the backend truthfully answered
    // that it had nothing to stop. Waiting for the message and asking again is
    // right *if the message became a turn*.
    //
    // Here it did not — the POST fails — and by the time it does, another tab
    // has started a turn of its own. `/cancel` names the conversation, not the
    // turn, so a second request would stop that one: a reader in another window
    // watching their work die for a message this one never sent.
    const held = gate();
    route('POST /messages', async () => {
      await held.opened;
      return json({ detail: 'gateway went away' }, 502);
    });
    route('POST /cancel', () => json({ cancelled: false, interrupted_role: '' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();

    void controller.interrupt();
    await settle();
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(0);

    // Another tab starts a turn, and this browser reattaches to nothing yet.
    controller.detach();
    controller.attach();
    await settle();

    held.open();
    await settle();
    // Not one request, in the end. The message never became a turn, so this
    // browser has nothing of its own to stop — and the only request it could
    // send would be the wildcard that takes the other tab's turn down.
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(0);
  });

  it('lets go of the connection a reload replaces', async () => {
    // Every place that installs a connection has to release the one it
    // replaces. The path that reaches this without a detach in between is the
    // late acknowledgement: a message accepted after a reload has already taken
    // the session over reconnects by reloading again, and a reload that simply
    // overwrote the field would abandon the subscription the first one opened —
    // one socket per occurrence, against the browser's budget for this host,
    // with the page looking perfectly healthy throughout.
    const held = gate();
    const resumed: Feed[] = [];
    route('GET /stream', (init) => {
      const feed = new Feed().breakOn(init?.signal);
      resumed.push(feed);
      return new Response(feed.stream, { status: 200 });
    });
    route('POST /messages', async (init) => {
      await held.opened;
      return new Response(new Feed().breakOn(init?.signal).stream, { status: 200 });
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();

    // Detaching defers the POST's abort rather than taking it; reattaching
    // opens a read beside it and bumps the generation past the send.
    controller.detach();
    controller.attach();
    await settle();
    expect(resumed).toHaveLength(1);

    held.open();
    await settle();
    // The send reconnected by reloading, so there is a second read — and the
    // first one is closed rather than left running with nobody reading it.
    expect(resumed).toHaveLength(2);
    expect(resumed[0].broken).toBe(true);
  });

  it('does not reattach a session nobody is watching when a message is refused', async () => {
    // `release` defers this send's abort behind its own answer, so a 409 can
    // arrive after the last panel has closed. Reloading then would open a
    // stream that no view holds a lease on and none can release.
    const held = gate();
    route('POST /messages', async () => {
      await held.opened;
      return json({ detail: 'a turn is already running' }, 409);
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();

    controller.detach();
    await settle();
    const before = calls.length;

    held.open();
    await settle();
    // The optimistic message is taken back — the backend refuses before storing
    // anything, so it really did not happen — and nothing else is asked for.
    expect(controller.getState().messages).toHaveLength(0);
    expect(controller.getState().error).toContain('already has a turn running');
    expect(calls).toHaveLength(before);
  });

  it('interrupt asks the server and waits for the turn to end', async () => {
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: 'implementer' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();
    // Still cancelling: the turn ends when the server says it ends, and events
    // between asking and stopping are part of the turn's record.
    expect(controller.getState().status).toBe('cancelling');
    feed.push('final', { text: 'stopped mid-thought' });
    await settle();
    expect(controller.getState().live).toHaveLength(1);
    feed.push('done', { text: 'stopped mid-thought' });
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
  });

  it('reads a done frame full of nulls', async () => {
    // What a failed turn sends, and what every backend older than the
    // `cancelled` label sent for a stopped one. A schema that only allowed a
    // string rejected the whole frame — and the frame it rejected was the one
    // that says the turn ended, so the session never left `streaming` and the
    // answer was never fetched.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    route('GET /', () => json(conversation([{ id: 1, role: 'assistant', content: 'Stopped.' }])));
    feed.push('done', {
      text: 'Stopped.',
      outcome: null,
      citations: null,
      citation_dictionary_id: null,
      citation_dsl_version: null,
      failure: null,
      naming_scheduled: false,
      interrupted_role: '',
    });
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().messages.at(-1)).toMatchObject({ content: 'Stopped.' });
    // And it read the frame rather than merely surviving it: the protocol
    // complaint is what a schema that had drifted would raise here.
    expect(controller.getState().error).toBeNull();
  });

  it('can be reattached after the stream drops', async () => {
    // `detached` has to be a state the Reattach button can leave. Setting the
    // status without clearing the attached flag made that button a no-op.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('detached');
    const before = calls.length;
    controller.attach();
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    expect(controller.getState().status).toBe('idle');
  });

  it('does not lose a turn that lands while the conversation is opening', async () => {
    // The turn that is hardest to catch is the one that ends during the open:
    // it is not in the history yet when the history is read, and it is over by
    // the time anything asks what is running. Whichever of the two reads
    // happens second is the one that has to see it — so what is running is
    // asked for first, and the answer arrives on that stream.
    const feed = new Feed();
    // The turn ends between the open's two reads, whichever way round they go:
    // the first read is answered as it stood before, the second as it stands
    // after. Whichever read comes second is therefore the one carrying the
    // answer — so putting history second is what makes the answer reachable,
    // and putting it first loses it in the gap.
    let reads = 0;
    const afterTheTurnEnded = () => {
      reads += 1;
      return reads > 1;
    };
    route('GET /stream', () =>
      afterTheTurnEnded()
        ? new Response(null, { status: 204 })
        : new Response(feed.stream, { status: 200 }),
    );
    route('GET /', () =>
      json(
        conversation(
          afterTheTurnEnded()
            ? [
                { id: 1, role: 'user', content: 'ask' },
                { id: 2, role: 'assistant', content: 'the answer that lands mid-open' },
              ]
            : [{ id: 1, role: 'user', content: 'ask' }],
        ),
      ),
    );
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    feed.push('done', { text: 'the answer that lands mid-open' });
    feed.close();
    await settle();

    expect(controller.getState().messages.map((message) => message.content)).toContain(
      'the answer that lands mid-open',
    );
    expect(controller.getState().status).toBe('idle');
  });

  it('does not keep a message the backend refused', async () => {
    // 409 means another turn is already running; the backend rejects before
    // storing anything, so the optimistic row is a message that was never sent.
    route('POST /messages', () => json({ detail: 'conversation already has an active turn' }, 409));
    const feed = new Feed();
    route('GET /stream', () => new Response(feed.stream, { status: 200 }));
    route('GET /', () => json(conversation([{ id: 1, role: 'user', content: 'the other turn' }])));
    const controller = sessionController(REF);
    // Not awaited: after a 409 the controller attaches to the turn that *is*
    // running, so this call resolves only when that turn ends.
    void controller.send('mine');
    await settle();
    expect(controller.getState().messages.map((message) => message.content)).toEqual([
      'the other turn',
    ]);
    expect(controller.getState().error).toContain('already has a turn running');
    // And it attaches to the turn that is running rather than reporting failure.
    expect(controller.getState().status).toBe('streaming');
  });

  it('a cancel that fails after the turn ended leaves it ended', async () => {
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const held = gate();
    route('POST /cancel', async () => {
      await held.opened;
      throw new TypeError('Failed to fetch');
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();
    feed.push('done', { text: 'finished on its own', outcome: null });
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
    held.open();
    await settle();
    // The refusal arrives after the turn is over; it must not resurrect it.
    expect(controller.getState().status).toBe('idle');
  });

  it('asks the server to stop even mid-handoff, and lets it pick the moment', async () => {
    // Where it is safe to interrupt is the server's question: it knows which
    // role the turn is inside right now, while this browser knows only what a
    // replayed stream has told it. Holding the request here delayed it and
    // could still fire it against a role the turn had already left.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: 'planner' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    feed.push('role_start', { role: 'planner' });
    await settle();
    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');
    expect(calls.some((call) => call.url.endsWith('/cancel'))).toBe(true);
  });

  it('cancels straight away once the role is ready', async () => {
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: 'planner' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    feed.push('role_start', { role: 'planner' });
    feed.push('role_ready', { role: 'planner' });
    await settle();
    void controller.interrupt();
    await settle();
    expect(calls.some((call) => call.url.endsWith('/cancel'))).toBe(true);
  });

  it('a cancel refused while reattaching still gets its answer', async () => {
    // A Stop belongs to the turn, not to the connection that asked for it. Tie
    // the answer to the connection and reattaching in the middle of one throws
    // the refusal away — leaving the session saying `cancelling` with nothing
    // left to correct it, and no way back but a reload of the page.
    const turn = new Feed();
    route('POST /messages', () => new Response(turn.stream, { status: 200 }));
    const held = gate();
    route('POST /cancel', async () => {
      await held.opened;
      throw new TypeError('Failed to fetch');
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();

    // The panel is closed and reopened while the Stop is still in flight. The
    // reload finds the turn still running and says `cancelling`, which is true.
    const replay = new Feed();
    route(
      'GET /stream',
      (init) => new Response(replay.breakOn(init?.signal).stream, { status: 200 }),
    );
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('cancelling');

    held.open();
    await settle();
    // Refused, so nothing is pending at the server: back to the turn that is
    // still running, with the reason, and the reader may ask again.
    expect(controller.getState().status).toBe('streaming');
    expect(controller.getState().error).toContain('could not reach');
  });

  it('waits for the message it raced rather than stopping whatever is running', async () => {
    // Stop can be clicked in the moment between the composer clearing and the
    // message being accepted: the composer offers Stop as soon as a message
    // leaves. There is no turn to name yet — and `/cancel` addresses the
    // conversation, so a request sent now would stop whatever else is running,
    // which is by definition not the turn the reader is waiting for.
    const feed = new Feed();
    const accepted = gate();
    route('POST /messages', async () => {
      await accepted.opened;
      return new Response(feed.stream, { status: 200, headers: { 'X-Turn-Id': 't_mine' } });
    });
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: '' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    void controller.interrupt();
    await settle();
    const stops = () => calls.filter((call) => call.url.includes('/cancel'));
    expect(stops()).toHaveLength(0);
    // The reader is told it is stopping all the same, which is true: the Stop
    // is outstanding and will go out the moment it can be addressed.
    expect(controller.getState().status).toBe('cancelling');

    accepted.open();
    await settle();
    expect(stops()).toHaveLength(1);
    // Named. By now the conversation could be running a different turn, and the
    // backend refuses a name that is not what is running rather than stopping
    // it — which is the only place that comparison can be made.
    expect(stops()[0].url).toContain('turn_id=t_mine');
    // And still stopping: the turn ends when the stream says it does.
    expect(controller.getState().status).toBe('cancelling');
  });

  it('names the turn its own message started, when Stop comes after it began', async () => {
    // The ordinary case, and the one every Stop takes: the turn is on screen
    // because the POST that started it opened a stream, and that response head
    // named it. Sent without the name, this Stop means "whatever is running" —
    // which is this turn until another tab starts one, and then silently is not.
    const feed = new Feed();
    route(
      'POST /messages',
      () => new Response(feed.stream, { status: 200, headers: { 'X-Turn-Id': 't_mine' } }),
    );
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: '' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    expect(controller.getState().status).toBe('streaming');

    void controller.interrupt();
    await settle();
    const stops = calls.filter((call) => call.url.includes('/cancel'));
    expect(stops).toHaveLength(1);
    expect(stops[0].url).toContain('turn_id=t_mine');
  });

  it('names the turn it reattached to, which the reconnect head told it', async () => {
    // A reader who opens a panel onto a turn already running and presses Stop
    // has the same problem and no message of their own to wait for. The name
    // comes off the reconnect response head instead — discarded, every Stop
    // after a reattach went out as a wildcard.
    const replay = new Feed();
    route(
      'GET /stream',
      (init) =>
        new Response(replay.breakOn(init?.signal).stream, {
          status: 200,
          headers: { 'X-Turn-Id': 't_theirs' },
        }),
    );
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: '' }));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('streaming');

    void controller.interrupt();
    await settle();
    const stops = calls.filter((call) => call.url.includes('/cancel'));
    expect(stops).toHaveLength(1);
    expect(stops[0].url).toContain('turn_id=t_theirs');
  });

  it('takes the server’s word for it when the turn it named is gone', async () => {
    // The retry names a turn the conversation is no longer running — another tab
    // started something in the meantime — so the backend refuses and leaves that
    // other turn alone. From here it looks like any other "nothing cancelled":
    // the turn this browser meant is over, which is what the Stop was asking
    // for, and the reload is how the reader finds out what took its place.
    const accepted = gate();
    route('POST /messages', async () => {
      await accepted.opened;
      return new Response(new Feed().stream, { status: 200, headers: { 'X-Turn-Id': 't_mine' } });
    });
    route('POST /cancel', () => json({ cancelled: false, stale: true }));
    route('GET /', () => json(conversation([{ id: 1, role: 'assistant', content: 'answered' }])));
    const controller = sessionController(REF);
    void controller.send('ask');
    void controller.interrupt();
    await settle();

    accepted.open();
    await settle();
    const stops = calls.filter((call) => call.url.includes('/cancel'));
    expect(stops).toHaveLength(1);
    expect(stops[0].url).toContain('turn_id=t_mine');
    // Asked once and no more: the refusal is an answer, not something to
    // escalate into a second request that would have to go out unnamed.
    expect(controller.getState().error).toContain('nothing to stop');
  });

  it('finds out what is running when the server says it stopped nothing', async () => {
    // Two pictures disagree about whether a turn exists, and it is not the
    // server's that is wrong. Reading the conversation again is the only
    // honest answer — and leaves it neither stuck `cancelling` nor claiming an
    // interruption that never happened.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    route('POST /cancel', () => json({ cancelled: false }));
    route('GET /', () => json(conversation([{ id: 1, role: 'assistant', content: 'answered' }])));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    await controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().error).toContain('nothing to stop');
    expect(controller.getState().messages.at(-1)).toMatchObject({ content: 'answered' });
  });

  it('hands the Stop button back when the message it was for was never answered', async () => {
    // The other half of "do not stop someone else's turn". Declining to retry is
    // right; keeping the Stop outstanding while declining is not. The session
    // then reads `cancelling` — Stop disabled — with no request pending at the
    // server, over a turn that this browser reattached to and can watch running.
    // Nothing ever clears it, so the only way out is a reload the reader has no
    // reason to think they need.
    const held = gate();
    const feed = new Feed();
    route('GET /stream', () => new Response(feed.stream, { status: 200 }));
    route('POST /messages', async () => {
      await held.opened;
      return json({ detail: 'gateway went away' }, 502);
    });
    route('POST /cancel', () => json({ cancelled: false, interrupted_role: '' }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();

    void controller.interrupt();
    await settle();
    // Reattaching finds the turn the message did start, so this is a session
    // watching a live turn — the case where a disabled Stop is a real loss.
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('cancelling');

    held.open();
    await settle();
    expect(controller.getState().status).toBe('streaming');
    // And the button works: this Stop has a turn to land on, which the first
    // one did not — so it is also the first request that goes out.
    void controller.interrupt();
    await settle();
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('does not reopen a stream nobody is watching when there was nothing to stop', async () => {
    // The reload after "nothing cancelled" is a question — what is running? —
    // and there is no one left to hear the answer. It installs a subscription
    // no view holds a lease on, so nothing will ever release it.
    const held = gate();
    const opened: Feed[] = [];
    route('GET /stream', (init) => {
      const feed = new Feed().breakOn(init?.signal);
      opened.push(feed);
      return new Response(feed.stream, { status: 200 });
    });
    route('POST /cancel', async () => {
      await held.opened;
      return json({ cancelled: false });
    });
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(opened).toHaveLength(1);

    void controller.interrupt();
    await settle();
    controller.detach();
    await settle();

    held.open();
    await settle();
    expect(opened).toHaveLength(1);
    // Said, not silent: the reader who comes back is told what became of the
    // Stop they asked for.
    expect(controller.getState().error).toContain('nothing to stop');
  });

  it('does not call a conversation idle when it could not ask what is running', async () => {
    // What failed is the question "is a turn running?". Not knowing the answer
    // is not knowing there is none: reading it as idle re-enables the composer,
    // and the message lands on a conversation that is already working.
    route('GET /stream', () => json({ detail: 'gateway' }, 502));
    route('GET /', () => json(conversation([{ id: 1, role: 'user', content: 'asked' }])));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('failed');
    expect(controller.canSend()).toBe(false);
    expect(controller.getState().error).toContain('502');
    // The history still read, so the reader keeps the conversation.
    expect(controller.getState().messages).toHaveLength(1);
    // And Retry must reach the server rather than find the session still
    // believing it is attached.
    route('GET /stream', () => new Response(null, { status: 204 }));
    const before = calls.length;
    controller.attach();
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    expect(controller.getState().status).toBe('idle');
  });

  it('ends the turn on a done frame it cannot read, and says it could not', async () => {
    // The framing says the turn is over. Treating an unreadable payload as "no
    // end yet" is how a finished conversation gets stuck saying it is working.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    route('GET /', () => json(conversation([{ id: 1, role: 'assistant', content: 'stored' }])));
    feed.push('done', { text: 12345 });
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().messages.at(-1)).toMatchObject({ content: 'stored' });
    expect(controller.getState().error).toContain('could not read');
  });

  it('ends the turn on a done frame whose payload will not parse', async () => {
    // The stronger version of the case above: not a payload that fails
    // validation but one that is not JSON at all. The framing still says the
    // turn is over, and a parser that drops the whole block takes that away —
    // leaving the conversation working with nothing left in the stream to end
    // it, and the composer disabled until the page is reloaded.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    route('GET /', () => json(conversation([{ id: 1, role: 'assistant', content: 'stored' }])));
    // Written straight to the wire: `push` would serialize valid JSON.
    feed.write('event: done\ndata: {broken\n\n');
    feed.close();
    await settle();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().error).toContain('could not read');
  });

  it('keeps the connection while any view is still watching', async () => {
    // Closing one panel must not silence a second one showing the same
    // conversation, so the subscription is reference counted.
    const feed = new Feed();
    route(
      'GET /stream',
      (init) => new Response(feed.breakOn(init?.signal).stream, { status: 200 }),
    );
    const controller = sessionController(REF);
    const first = controller.observe();
    const second = controller.observe();
    await settle();
    expect(controller.getState().status).toBe('streaming');
    first();
    await settle();
    expect(feed.broken).toBe(false);
    expect(controller.getState().status).toBe('streaming');
    second();
    await settle();
    expect(feed.broken).toBe(true);
    expect(controller.getState().status).toBe('detached');
  });

  it('releases once however many times a view says it stopped', async () => {
    // A component can run its cleanup twice — React's development double-mount
    // does exactly that — and a second decrement would take the count below the
    // one view still watching and silence it.
    const feed = new Feed();
    route(
      'GET /stream',
      (init) => new Response(feed.breakOn(init?.signal).stream, { status: 200 }),
    );
    const controller = sessionController(REF);
    const first = controller.observe();
    controller.observe();
    await settle();
    first();
    first();
    await settle();
    expect(feed.broken).toBe(false);
    expect(controller.getState().status).toBe('streaming');
  });

  it('ignores what a superseded connection is still delivering', async () => {
    // Reattaching does not reach into the old socket to stop it: the fetch is
    // aborted, but a chunk already in flight still arrives. Applying it would
    // append the old turn's events to the new connection's transcript.
    const stale = new Feed();
    route('GET /stream', () => new Response(stale.stream, { status: 200 }));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    stale.push('final', { text: 'from the old connection' });
    await settle();
    expect(controller.getState().live).toHaveLength(1);

    const fresh = new Feed();
    route('GET /stream', () => new Response(fresh.stream, { status: 200 }));
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().live).toEqual([]);

    stale.push('final', { text: 'late from the old connection' });
    stale.breakNow();
    await settle();
    expect(controller.getState().live).toEqual([]);
    expect(controller.getState().status).toBe('streaming');
  });

  it('can page again after a page failed to load', async () => {
    // An older page failing does not tear down the conversation, so the reader
    // is left looking at a Load earlier button. It has to still work.
    route('GET /', (_init, url) => {
      const earlier = String(url).includes('before=');
      return json(
        conversation(
          [{ id: earlier ? 1 : 51, role: 'user', content: earlier ? 'older' : 'newest' }],
          page(earlier ? 0 : 50, 1, 51),
        ),
      );
    });
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().hasEarlier).toBe(true);

    let refuse = true;
    const answer = routes.get('GET /')!;
    route('GET /', (init, url) => {
      if (refuse && String(url).includes('before=')) return json({ detail: 'no' }, 503);
      return answer(init, url);
    });
    await controller.loadEarlier();
    await settle();
    expect(controller.getState().error).toContain('503');
    expect(controller.getState().startIndex).toBe(50);

    refuse = false;
    await controller.loadEarlier();
    await settle();
    expect(controller.getState().startIndex).toBe(0);
    expect(controller.getState().messages).toHaveLength(2);
  });

  it('reattaches when a view comes back', async () => {
    const controller = sessionController(REF);
    controller.observe()();
    await settle();
    const before = calls.length;
    controller.observe();
    await settle();
    expect(calls.length).toBeGreaterThan(before);
  });

  it('interrupt on an idle session does nothing', async () => {
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    await controller.interrupt();
    expect(calls.some((call) => call.url.endsWith('/cancel'))).toBe(false);
  });

  it('a slow load cannot overwrite the state a newer one already wrote', async () => {
    const held = gate();
    let first = true;
    route('GET /', async () => {
      // Only the first read is held, so the second can answer while it waits.
      if (first) {
        first = false;
        await held.opened;
        return json(conversation([{ id: 1, role: 'user', content: 'stale' }]));
      }
      return json(conversation([{ id: 2, role: 'user', content: 'fresh' }]));
    });
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    // Reattaching starts a second read under a newer generation.
    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().messages.map((message) => message.content)).toEqual(['fresh']);
    held.open();
    await settle();
    // The first read lands last and must change nothing.
    expect(controller.getState().messages.map((message) => message.content)).toEqual(['fresh']);
  });

  it('refuses to send into a conversation that has not finished loading', async () => {
    // Whether a turn is already running is exactly what the load is about to
    // answer, and a send that raced it would be rejected with a 409 — or worse,
    // accepted against a conversation the user has not seen.
    const held = gate();
    route('GET /', async () => {
      await held.opened;
      return json(conversation([]));
    });
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    await controller.send('too early');
    expect(controller.getState().messages).toEqual([]);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    held.open();
    await settle();
    expect(controller.canSend()).toBe(true);
  });

  it('says so when the conversation has been deleted', async () => {
    route('GET /', () => json({ detail: 'conversation not found' }, 404));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('failed');
    expect(controller.getState().error).toContain('404');
  });

  it('reports an unreachable backend as something to retry', async () => {
    route('GET /', () => Promise.reject(new TypeError('Failed to fetch')));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().error).toContain('could not reach the conversation backend');
  });

  it('loads an earlier page and keeps what is already on screen', async () => {
    route('GET /', () =>
      json(conversation([{ id: 3, role: 'user', content: 'c' }], page(2, 1, 3))),
    );
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().hasEarlier).toBe(true);
    route('GET /', () =>
      json(
        conversation(
          [
            { id: 1, role: 'user', content: 'a' },
            { id: 2, role: 'assistant', content: 'b' },
          ],
          page(0, 2, 3),
        ),
      ),
    );
    await controller.loadEarlier();
    expect(controller.getState().messages.map((message) => message.content)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(controller.getState().hasEarlier).toBe(false);
    expect(calls.at(-1)?.url).toContain('before=2');
  });

  it('two clicks on load-earlier fetch one page, not the same page twice', async () => {
    // The generation number does not cover this: paging invalidates nothing, so
    // both calls would run under the same generation, ask for the same
    // `before`, and both apply — the same messages in twice.
    route('GET /', () =>
      json(conversation([{ id: 50, role: 'user', content: 'c' }], page(50, 1, 51))),
    );
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    const held = gate();
    route('GET /', async () => {
      await held.opened;
      return json(conversation([{ id: 0, role: 'user', content: 'a' }], page(49, 1, 51)));
    });
    const first = controller.loadEarlier();
    const second = controller.loadEarlier();
    held.open();
    await Promise.all([first, second]);
    expect(calls.filter((call) => call.url.includes('before='))).toHaveLength(1);
    expect(controller.getState().messages.map((message) => message.id)).toEqual([0, 50]);
    expect(controller.getState().startIndex).toBe(49);
  });

  it('an earlier page failing does not tear down the conversation being read', async () => {
    route('GET /', () =>
      json(conversation([{ id: 3, role: 'user', content: 'c' }], page(2, 1, 3))),
    );
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    route('GET /', () => json({ detail: 'gone' }, 500));
    await controller.loadEarlier();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().messages).toHaveLength(1);
    expect(controller.getState().error).toContain('500');
  });

  it('rejects a response whose shape this build does not read', async () => {
    route('GET /', () => json({ id: 'c1' }));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('failed');
    expect(controller.getState().error).toContain('messages');
  });

  it('notifies subscribers on every change and stops after unsubscribe', async () => {
    const controller = sessionController(REF);
    const seen: string[] = [];
    const stop = controller.subscribe(() => seen.push(controller.getState().status));
    controller.attach();
    await settle();
    expect(seen).toContain('loading');
    stop();
    const before = seen.length;
    // A change that definitely notifies: detaching an idle session would not,
    // so this test would pass with a broken unsubscribe.
    controller.detach();
    controller.attach();
    await settle();
    expect(seen).toHaveLength(before);
  });
  it('still says a turn is stopping after the panel is closed and reopened', async () => {
    // Closing a panel is not changing one's mind. The request is with the
    // server; coming back saying "working" would describe a turn the reader
    // has already stopped.
    const turn = new Feed();
    route(
      'POST /messages',
      (init) => new Response(turn.breakOn(init?.signal).stream, { status: 200 }),
    );
    const held = gate();
    route('POST /cancel', async () => {
      // The backend holds the request until the handoff is complete.
      await held.opened;
      return json({ cancelled: true, interrupted_role: 'planner' });
    });
    const controller = sessionController(REF);
    const release = controller.observe();
    await settle();
    void controller.send('ask');
    await settle();
    turn.push('role_start', { role: 'planner' });
    await settle();
    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');

    release();
    await settle();
    expect(controller.getState().status).toBe('detached');

    const replay = new Feed();
    route(
      'GET /stream',
      (init) => new Response(replay.breakOn(init?.signal).stream, { status: 200 }),
    );
    controller.observe();
    await settle();
    expect(controller.getState().status).toBe('cancelling');
    // And it is not asked twice: the first request is still the server's.
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1);
    held.open();
  });

  it('comes back saying stopping when it comes back to the turn it stopped', async () => {
    // The case above with identities on both ends, which is what makes it a
    // test of anything: a retained Stop that survives a reconnect proves only
    // that something was kept unless the turn on the other end is named and is
    // the same one.
    const turn = new Feed();
    route(
      'POST /messages',
      (init) =>
        new Response(turn.breakOn(init?.signal).stream, {
          status: 200,
          headers: { 'X-Turn-Id': 't_a' },
        }),
    );
    const held = gate();
    route('POST /cancel', async () => {
      await held.opened;
      return json({ cancelled: true, interrupted_role: 'planner' });
    });
    const replay = new Feed();
    route(
      'GET /stream',
      (init) =>
        new Response(replay.breakOn(init?.signal).stream, {
          status: 200,
          headers: { 'X-Turn-Id': 't_a' },
        }),
    );
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');

    controller.detach();
    controller.attach();
    await settle();
    // The same turn is still running, so it is still the one that was stopped.
    expect(controller.getState().status).toBe('cancelling');
    expect(calls.filter((call) => call.url.includes('/cancel'))).toHaveLength(1);
    held.open();
    await settle();
  });

  it('does not say a different turn is stopping because an earlier one was', async () => {
    // The counter-case. The reader stops turn A and closes the panel before A
    // is finished with; by the time they come back the conversation is running
    // B — another tab's, or the next one along. Carried over, the Stop makes B
    // read `cancelling` with its own Stop disabled, and nothing arrives that
    // could correct it: the only answer still coming is about A, and it is
    // affirmative, so it settles A and leaves B saying it is stopping forever.
    const turnA = new Feed();
    route(
      'POST /messages',
      (init) =>
        new Response(turnA.breakOn(init?.signal).stream, {
          status: 200,
          headers: { 'X-Turn-Id': 't_a' },
        }),
    );
    const answeredA = gate();
    route('POST /cancel', async (_init, url) => {
      if (String(url).includes('turn_id=t_a')) {
        await answeredA.opened;
        return json({ cancelled: true, interrupted_role: 'planner' });
      }
      return json({ cancelled: true, interrupted_role: '' });
    });
    const turnB = new Feed();
    route(
      'GET /stream',
      (init) =>
        new Response(turnB.breakOn(init?.signal).stream, {
          status: 200,
          headers: { 'X-Turn-Id': 't_b' },
        }),
    );
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();

    controller.detach();
    controller.attach();
    await settle();
    // B is running and nobody has asked for it to stop.
    expect(controller.getState().status).toBe('streaming');

    answeredA.open();
    await settle();
    // A's Stop is answered, for A. It says nothing about the turn on screen.
    expect(controller.getState().status).toBe('streaming');

    // And Stop is the reader's to press again, naming what it is now about.
    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');
    const stops = calls.filter((call) => call.url.includes('/cancel'));
    expect(stops.map((call) => call.url.split('turn_id=')[1])).toEqual(['t_a', 't_b']);
  });

  it('does not let a dropped Stop’s refusal answer for the Stop that replaced it', async () => {
    // The same A-then-B story, with A's answer arriving late — after the reader
    // has pressed Stop on B — and negative, which is what the backend says about
    // a turn that is over. Read as this session's news it withdraws B's Stop and
    // reloads with "nothing to stop", so the one Stop that *is* outstanding at
    // the server disappears from the screen, with a banner denying it. Each Stop
    // is its own request, and an answer belongs to the request that asked.
    const turnA = new Feed();
    route(
      'POST /messages',
      (init) =>
        new Response(turnA.breakOn(init?.signal).stream, {
          status: 200,
          headers: { 'X-Turn-Id': 't_a' },
        }),
    );
    const answeredA = gate();
    route('POST /cancel', async (_init, url) => {
      if (String(url).includes('turn_id=t_a')) {
        await answeredA.opened;
        // A is long gone; the backend refuses rather than stopping B in its place.
        return json({ cancelled: false, stale: true });
      }
      return json({ cancelled: true, interrupted_role: '' });
    });
    route('GET /stream', (init) => {
      const turnB = new Feed().breakOn(init?.signal);
      return new Response(turnB.stream, { status: 200, headers: { 'X-Turn-Id': 't_b' } });
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    await settle();
    void controller.interrupt();
    await settle();

    controller.detach();
    controller.attach();
    await settle();
    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');

    answeredA.open();
    await settle();
    // B's Stop is still the outstanding one, and still the one on screen.
    expect(controller.getState().status).toBe('cancelling');
    expect(controller.getState().error).toBeNull();
  });

  it('keeps a Stop that is still waiting to learn which turn it is for', async () => {
    // The exemption, and why the comparison cannot simply be made. A Stop
    // pressed while the message is still in flight has nothing to compare: the
    // turn it is for is whatever that message becomes, and a reconnect that
    // names a turn is no evidence of a different one — it is most likely the
    // very turn the message started. Withdrawn on that comparison, the one Stop
    // that exists because it could not be aimed is thrown away, and the retry
    // that would finally aim it finds itself no longer the outstanding one.
    const held = gate();
    route('POST /messages', async (init) => {
      await held.opened;
      return new Response(new Feed().breakOn(init?.signal).stream, {
        status: 200,
        headers: { 'X-Turn-Id': 't_mine' },
      });
    });
    route('POST /cancel', () => json({ cancelled: true, interrupted_role: '' }));
    // A fresh replay per reconnect: the acknowledgement lands after a reload
    // has taken the session over, so the send reconnects by reloading again,
    // and a body that has already been let go of cannot be read twice.
    route('GET /stream', (init) => {
      const replay = new Feed().breakOn(init?.signal);
      return new Response(replay.stream, { status: 200, headers: { 'X-Turn-Id': 't_mine' } });
    });
    const controller = sessionController(REF);
    void controller.send('ask');
    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');

    controller.detach();
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('cancelling');
    expect(calls.filter((call) => call.url.includes('/cancel'))).toHaveLength(0);

    held.open();
    await settle();
    const stops = calls.filter((call) => call.url.includes('/cancel'));
    expect(stops).toHaveLength(1);
    expect(stops[0].url).toContain('turn_id=t_mine');
    expect(controller.getState().status).toBe('cancelling');
  });

  it('a failed turn gives up the connection, so retrying really reconnects', async () => {
    // A failure that kept `attached` set would make `attach()` return without
    // doing anything, so the Retry the reader is offered would do nothing.
    route('POST /messages', () => json({ detail: 'boom' }, 500));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    await controller.send('ask');
    await settle();
    expect(controller.getState().status).toBe('failed');
    // And sending again is refused: the last thing known about this
    // conversation is that it could not be read.
    expect(controller.canSend()).toBe(false);
    const before = calls.length;
    controller.attach();
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    expect(controller.getState().status).toBe('idle');
  });

  it('never reports a running turn as idle while reattaching to it', async () => {
    // The history read lands before the stream is consumed. A moment of `idle`
    // in between is a moment in which the composer says the agent is free.
    const feed = new Feed();
    route(
      'GET /stream',
      (init) => new Response(feed.breakOn(init?.signal).stream, { status: 200 }),
    );
    const { current, seen } = states();
    sessionController(REF).attach();
    await settle();
    expect(current().status).toBe('streaming');
    expect(seen.map((state) => state.status)).not.toContain('idle');
  });

  it('a history read that lands after the last view has gone announces nothing', async () => {
    // Detaching does not bump the generation \u2014 it invalidates nothing \u2014
    // so without the abort check a slow history read would announce a running
    // turn over a connection that has already been let go.
    const feed = new Feed();
    const held = gate();
    let history: AbortSignal | undefined;
    route(
      'GET /stream',
      (init) => new Response(feed.breakOn(init?.signal).stream, { status: 200 }),
    );
    route('GET /', async (init) => {
      history = init?.signal ?? undefined;
      await held.opened;
      return json(conversation([]));
    });
    const controller = sessionController(REF);
    const release = controller.observe();
    await settle();
    release();
    held.open();
    await settle();
    expect(controller.getState().status).toBe('detached');
    expect(feed.broken).toBe(true);
    // The history read is let go of as well, rather than left to complete for
    // a reader who is no longer there.
    expect(history?.aborted).toBe(true);
  });

  it('takes back a refused message even when the recovery read also fails', async () => {
    // Rollback must not depend on a successful read: the case where the reader
    // can least explain a message they never sent is the case where everything
    // went wrong at once.
    route('POST /messages', () => json({ detail: 'already running' }, 409));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    route('GET /', () => json({ detail: 'gone' }, 500));
    await controller.send('ask');
    await settle();
    expect(controller.getState().messages).toEqual([]);
    expect(controller.getState().status).toBe('failed');
  });

  it('a connection that breaks mid-turn leaves the session reattachable', async () => {
    // A rejected read, not a clean EOF: this is what a dropped connection
    // actually looks like, and it used to leave `attached` set so that the
    // Retry the reader is offered did nothing at all.
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    void controller.send('ask');
    await settle();
    feed.breakNow();
    await settle();
    expect(controller.getState().status).toBe('failed');
    const before = calls.length;
    controller.attach();
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    expect(controller.getState().status).toBe('idle');
  });

  it('discards a page of history that answers after the window moved', async () => {
    // The generation number does not cover paging, so the boundary is the
    // guard: a page answers "what precedes position N", and it may only be
    // applied while N is still the first thing on screen. A turn ending
    // underneath moves N without invalidating anything.
    const held = gate();
    const feed = new Feed();
    route('POST /messages', () => new Response(feed.stream, { status: 200 }));
    route('GET /', async (_init, url) => {
      if (url?.includes('before=') === true) {
        await held.opened;
        return json(conversation([{ id: 1, role: 'user', content: 'older' }], page(0, 1, 12)));
      }
      return json(conversation([{ id: 5, role: 'user', content: 'newest' }], page(10, 1, 12)));
    });
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().startIndex).toBe(10);

    void controller.send('ask');
    await settle();
    void controller.loadEarlier();
    await settle();

    // The turn ends while the page is in flight; the refetch moves the window.
    route('GET /', (_init, url) =>
      url?.includes('before=') === true
        ? json(conversation([], page(0, 0, 13)))
        : json(conversation([{ id: 6, role: 'assistant', content: 'answered' }], page(11, 1, 13))),
    );
    feed.push('done', { text: 'answered', outcome: 'final_answer' });
    feed.close();
    await settle();
    expect(controller.getState().startIndex).toBe(11);

    held.open();
    await settle();
    // The stale page names a boundary that no longer exists, so it is dropped.
    expect(controller.getState().messages.map((message) => message.content)).toEqual(['answered']);
    expect(controller.getState().startIndex).toBe(11);
  });

  it('refuses to send in every state except idle', async () => {
    const feed = new Feed();
    route(
      'GET /stream',
      (init) => new Response(feed.breakOn(init?.signal).stream, { status: 200 }),
    );
    route('POST /cancel', () => json({ cancelled: true }));
    const controller = sessionController(REF);
    controller.attach();
    await settle();
    expect(controller.getState().status).toBe('streaming');
    expect(controller.canSend()).toBe(false);
    const before = calls.length;
    await controller.send('ask');
    expect(calls).toHaveLength(before);

    void controller.interrupt();
    await settle();
    expect(controller.getState().status).toBe('cancelling');
    expect(controller.canSend()).toBe(false);

    controller.detach();
    await settle();
    expect(controller.getState().status).toBe('detached');
    expect(controller.canSend()).toBe(false);
    await controller.send('ask');
    expect(calls.some((call) => call.url.endsWith('/messages'))).toBe(false);
  });
});
