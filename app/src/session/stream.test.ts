import { afterEach, describe, expect, it, vi } from 'vitest';

import { openTurnStream, readEventStream, StreamStalledError, toTurnEvent } from './stream';

/** A body that hands the reader whatever chunking the case is about. */
function body(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: readonly string[]) {
  const seen = [];
  for await (const event of readEventStream(body(chunks))) seen.push(event);
  return seen;
}

describe('readEventStream', () => {
  it('reads one event per blank-line-terminated block', async () => {
    expect(
      await collect([
        'event: role_start\ndata: {"role":"planner"}\n\nevent: final\ndata: {"text":"done"}\n\n',
      ]),
    ).toEqual([
      { kind: 'role_start', data: { role: 'planner' } },
      { kind: 'final', data: { text: 'done' } },
    ]);
  });

  it('joins an event split across network chunks', async () => {
    // The transport decides where the bytes break, so a parser that assumed one
    // chunk was one event would drop text at every buffer boundary.
    expect(await collect(['event: fin', 'al\ndata: {"te', 'xt":"hello"}\n\n'])).toEqual([
      { kind: 'final', data: { text: 'hello' } },
    ]);
  });

  it('keeps blank lines inside a message body', async () => {
    const [event] = await collect(['event: final\ndata: {"text":"a\\n\\nb"}\n\n']);
    expect(event.data).toEqual({ text: 'a\n\nb' });
  });

  it('reads an event whose JSON spans several data lines', async () => {
    // A backend that pretty-prints its JSON emits several `data:` lines for one
    // event, and the SSE grammar's newline join and leading-space strip are
    // what reassemble it. Neither is observable on its own here: JSON parses
    // the same whatever whitespace separates the two halves.
    expect(await collect(['event: final\ndata: {"text":\ndata: "two lines"}\n\n'])).toEqual([
      { kind: 'final', data: { text: 'two lines' } },
    ]);
  });

  it('reassembles a character split across two chunks', async () => {
    // A multi-byte character can straddle a network boundary, and decoding each
    // chunk independently would put a replacement character in the message.
    const bytes = new TextEncoder().encode('event: final\ndata: {"text":"运行"}\n\n');
    const split = 30; // Inside the first Chinese character's three bytes.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const seen = [];
    for await (const event of readEventStream(stream)) seen.push(event);
    expect(seen).toEqual([{ kind: 'final', data: { text: '运行' } }]);
  });

  it('ignores comment lines', async () => {
    expect(await collect([': keep-alive\n\nevent: final\ndata: {"text":"x"}\n\n'])).toEqual([
      { kind: 'final', data: { text: 'x' } },
    ]);
  });

  it('keeps a frame whose payload it cannot read, and keeps reading', async () => {
    // A lost payload is not a lost turn. Throwing here would end the stream
    // over one bad frame; dropping the frame entirely would hide the one thing
    // still known about it — which event it was — from a consumer that decides
    // a turn has ended from the framing alone.
    expect(
      await collect(['event: done\ndata: {not json\n\nevent: final\ndata: {"text":"after"}\n\n']),
    ).toEqual([
      { kind: 'done', data: null },
      { kind: 'final', data: { text: 'after' } },
    ]);
  });

  it('closes the reader when the consumer stops early', async () => {
    // The consumer stops as soon as its generation is superseded. Leaving the
    // reader open would hold the socket for as long as the page lives, and a
    // reader is not released by dropping the generator.
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: final\ndata: {"text":"one"}\n\n'));
        controller.enqueue(encoder.encode('event: final\ndata: {"text":"two"}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of readEventStream(body)) {
      expect(event.kind).toBe('final');
      break;
    }
    expect(cancelled).toBe(true);
  });

  it('gives up on a stream that carries nothing for the idle window', async () => {
    // A dropped connection that neither end noticed: the reader would wait on
    // it for as long as the page lives.
    let cancelled = false;
    const silent = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: final\ndata: {"text":"one"}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of readEventStream(silent, 30)) seen.push(event.kind);
      })(),
    ).rejects.toBeInstanceOf(StreamStalledError);
    expect(seen).toEqual(['final']);
    expect(cancelled).toBe(true);
  });

  it('counts keepalive comments as a live connection', async () => {
    const encoder = new TextEncoder();
    const kept = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let beat = 0; beat < 4; beat += 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
        controller.close();
      },
    });
    const seen = [];
    for await (const event of readEventStream(kept, 40)) seen.push(event);
    expect(seen).toEqual([{ kind: 'done', data: {} }]);
  });

  it('yields a trailing event that the server did not terminate', async () => {
    expect(await collect(['event: done\ndata: {"text":"end"}'])).toEqual([
      { kind: 'done', data: { text: 'end' } },
    ]);
  });
});

describe('toTurnEvent', () => {
  it('takes the kind from the SSE event name, not the payload', async () => {
    // The framing is authoritative: a payload that happens to carry a `kind`
    // field must not be able to relabel the event it arrived in.
    expect(toTurnEvent({ kind: 'final', data: { kind: 'error', text: 'x' } })).toEqual({
      kind: 'final',
      text: 'x',
    });
  });

  it('passes through fields this build does not know', () => {
    const event = toTurnEvent({ kind: 'tool_call', data: { tool: 'grep', text: 'x' } });
    expect(event).toMatchObject({ kind: 'tool_call', tool: 'grep' });
  });

  it('rejects a frame with no kind', () => {
    expect(toTurnEvent({ kind: '', data: {} })).toBeNull();
  });

  it('reads a frame with no payload as the event alone', () => {
    expect(toTurnEvent({ kind: 'role_ready', data: 'not an object' })).toEqual({
      kind: 'role_ready',
    });
  });
});

describe('openTurnStream', () => {
  const REF = { workspace: 'w_main', conversation: 'c1' };

  /** The request this module made, so a test can check what was sent. */
  let sent: { url: string; init: RequestInit } | null;

  function answers(headers: Record<string, string>) {
    sent = null;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      sent = { url: String(url), init };
      return Promise.resolve(
        new Response(body(['event: final\ndata: {"text":"hi"}\n\n']), { status: 200, headers }),
      );
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the message as the POST body the backend reads it from', async () => {
    // The stub answers whatever it is asked, so nothing else here would notice
    // a send that carried no message at all: every assertion below is about the
    // response. A turn started from an empty body is a turn about nothing.
    answers({ 'content-type': 'text/event-stream' });
    const signal = new AbortController().signal;
    await openTurnStream(REF, { text: 'ask', mode: 'plan' }, signal);
    expect(sent?.url).toBe('/api/agent/v1/workspaces/w_main/conversations/c1/messages');
    expect(sent?.init.method).toBe('POST');
    expect(JSON.parse(String(sent?.init.body))).toEqual({ text: 'ask', mode: 'plan' });
    // Content type and accept both, because the backend branches on the second:
    // without it there is no promise that what comes back is a stream.
    expect(sent?.init.headers).toMatchObject({
      'content-type': 'application/json',
      accept: 'text/event-stream',
    });
    // The caller's signal, which is what lets a closing panel let go of a turn.
    expect(sent?.init.signal).toBe(signal);
  });

  it('reads which turn the backend started off the response head', async () => {
    // Off the head, not out of the stream: the Stop retry that needs this name
    // runs the moment the response arrives, which is before any frame has been
    // read — and that delay is the race it exists for.
    answers({ 'content-type': 'text/event-stream', 'X-Turn-Id': 't_9f3' });
    const opened = await openTurnStream(REF, { text: 'ask' }, new AbortController().signal);
    expect(opened.turnId).toBe('t_9f3');
    const seen = [];
    for await (const event of opened.events) seen.push(event);
    expect(seen).toEqual([{ kind: 'final', data: { text: 'hi' } }]);
  });

  it('has no turn to name when the backend did not name one', async () => {
    answers({ 'content-type': 'text/event-stream' });
    expect(
      (await openTurnStream(REF, { text: 'ask' }, new AbortController().signal)).turnId,
    ).toBeNull();
  });

  it('treats an empty name as no name at all', async () => {
    // Sent back on a Stop it would be compared with a real id and refused every
    // time — a Stop that can never succeed, which is worse than an unnamed one.
    answers({ 'content-type': 'text/event-stream', 'X-Turn-Id': '' });
    expect(
      (await openTurnStream(REF, { text: 'ask' }, new AbortController().signal)).turnId,
    ).toBeNull();
  });
});
