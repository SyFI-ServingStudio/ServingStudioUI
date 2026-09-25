/**
 * Reading a turn's event stream.
 *
 * `EventSource` is not used. Sending a message is a POST with a body, and the
 * browser's `EventSource` can only GET — so the framing is parsed here, over
 * `fetch`, and the same parser then serves both the POST that starts a turn and
 * the GET that reattaches to one already running.
 *
 * What this module will not do is cancel the turn. Dropping the subscription
 * closes a browser connection and nothing more; the turn keeps running on the
 * server and can be reattached to. Cancelling is `api.cancelTurn`, and the two
 * are kept apart on purpose — see the note there.
 */
import { conversationPath, sessionFetch, SessionApiError } from './api';
import { turnEventSchema, type SessionRef, type TurnEvent } from './types';

/**
 * How long a turn stream may carry no bytes before it counts as dead.
 *
 * The backend sends a keepalive comment after 15 s without an event, so a
 * healthy stream is never quiet this long. A stream that is has been dropped
 * somewhere between the two ends without either being told — a proxy or NAT
 * timing out an idle connection — and a read on it would wait forever.
 */
export const STREAM_IDLE_MS = 45_000;

/** The stream carried nothing for longer than `STREAM_IDLE_MS`. */
export class StreamStalledError extends Error {
  constructor(idleMs: number) {
    super(`the event stream carried nothing for ${Math.round(idleMs / 1000)} s`);
    this.name = 'StreamStalledError';
  }
}

/** One `event:`/`data:` block, before it is validated. */
export interface RawStreamEvent {
  readonly kind: string;
  readonly data: unknown;
}

/**
 * Split an SSE byte stream into events.
 *
 * A generator rather than a callback so the consumer controls the pace and so
 * `for await ... of` cleanup closes the reader on any exit path — including the
 * one where the consumer stops early because its generation was superseded.
 *
 * Fields are joined with newlines per the SSE grammar: a backend that
 * pretty-prints a payload emits one `data:` line per source line, and joining
 * them with anything else would produce something that will not parse. The one
 * optional leading space is stripped because the grammar says so — with JSON
 * payloads it makes no observable difference, since JSON ignores that
 * whitespace, so this is compliance rather than a fix for anything seen.
 */
export async function* readEventStream(
  body: ReadableStream<Uint8Array>,
  idleMs: number = STREAM_IDLE_MS,
): AsyncGenerator<RawStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      // Any bytes count, keepalive comments included: the question is whether
      // the connection is alive, not whether the turn has news.
      const { done, value } = await readWithin(reader, idleMs);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A blank line terminates an event. Anything after the last one is a
      // partial event and stays buffered.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(block);
        if (event !== null) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
    const trailing = parseBlock(buffer);
    if (trailing !== null) yield trailing;
  } finally {
    reader.cancel().catch(() => {
      // The consumer has gone; a failure to close a socket it no longer reads
      // is not something anyone can act on.
    });
  }
}

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreamStalledError(idleMs)), idleMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

function parseBlock(block: string): RawStreamEvent | null {
  let kind = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) kind = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0 && kind === 'message') return null;
  const raw = data.join('\n');
  try {
    return { kind, data: raw === '' ? {} : JSON.parse(raw) };
  } catch {
    // The payload is lost; the frame is not. The consumer decides a turn has
    // ended from the *framing* — `event: done` — precisely so that a payload
    // this build cannot read still ends the turn, and dropping the whole block
    // took that away: the conversation went on saying it was working with
    // nothing left in the stream to end it.
    //
    // `null` rather than `{}`, so that the frame carries "this did not decode"
    // rather than an object the caller could mistake for what was sent. No
    // consumer tells the two apart today — `toTurnEvent` reads either as an
    // event with nothing but its kind — and this is not a claim that one does.
    // It is what this function says about the wire, kept so that a consumer
    // *could* act on it rather than having to infer it from an empty payload.
    return { kind, data: null };
  }
}

/** A raw frame into the event type, with its wire `kind` preserved. */
export function toTurnEvent(raw: RawStreamEvent): TurnEvent | null {
  const payload = typeof raw.data === 'object' && raw.data !== null ? raw.data : {};
  const parsed = turnEventSchema.safeParse({ ...payload, kind: raw.kind });
  return parsed.success ? parsed.data : null;
}

/**
 * A turn that has started: its events, and which turn it is.
 *
 * The id comes off the response head rather than out of the stream, so it is
 * known before a single frame is read. That is the point of it — a Stop that
 * has to be re-sent once the message lands needs to name the turn the message
 * became, and it needs it exactly then. `null` when the backend named none,
 * which is an older backend and is treated as "no turn to name": the Stop falls
 * back to meaning whatever is running.
 */
export interface TurnConnection {
  readonly events: AsyncGenerator<RawStreamEvent>;
  readonly turnId: string | null;
}

/**
 * Start a turn and read its events.
 *
 * The POST *is* the stream: the backend answers the send with `text/event-stream`
 * rather than acknowledging and asking the caller to connect separately, so
 * there is no window in which a turn has started and nothing is listening.
 */
export async function openTurnStream(
  ref: SessionRef,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<TurnConnection> {
  const opened = await fetchStream(`${conversationPath(ref)}/messages`, signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (opened === null) throw new SessionApiError('the backend accepted the turn with no stream', 0);
  return opened;
}

/**
 * Reattach to a turn that is already running.
 *
 * `null` means there is nothing to attach to — the backend answers 204 for an
 * idle conversation, which is a normal state and not an error. Treating it as
 * one would put a failure banner on every conversation the user simply opened.
 *
 * The identity comes back with the events for the same reason it does on a
 * POST: a reader who reattaches and then presses Stop is stopping *this* turn,
 * and `/cancel` addresses the conversation. Discarded here, the id was
 * available on the wire and thrown away, and every Stop after a reattach went
 * out as a wildcard.
 */
export async function resumeTurnStream(
  ref: SessionRef,
  signal: AbortSignal,
): Promise<TurnConnection | null> {
  return fetchStream(`${conversationPath(ref)}/stream`, signal, {
    headers: { accept: 'text/event-stream' },
  });
}

async function fetchStream(
  url: string,
  signal: AbortSignal,
  init: RequestInit,
): Promise<TurnConnection | null> {
  // Failing is `sessionFetch`'s job; what is left here is the two ways a
  // successful response can still carry no stream. `204` is the backend saying
  // the conversation is idle, and a 200 with no body is a backend that answered
  // without opening one — neither is an error, and both mean "nothing to read".
  const response = await sessionFetch(url, { ...init, signal });
  if (response.status === 204 || response.body === null) return null;
  const named = response.headers.get('x-turn-id');
  return {
    events: readEventStream(response.body),
    // An empty header is not a name. Read as one it would be sent back on a
    // Stop, where the backend would compare it with a real id and refuse
    // forever.
    turnId: named === null || named === '' ? null : named,
  };
}
