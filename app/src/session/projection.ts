/**
 * Turn events into something a panel can render.
 *
 * The one place that relates the two shapes of a conversation: the events a
 * turn publishes while it runs, and the message that survives it. Everything
 * here is a pure function of its arguments — no network, no clock — so the live
 * view and the reloaded view can be checked against each other in a unit test.
 *
 * The compatibility direction matters more than it looks. A message stored
 * before the backend recorded an `activity` list has no events at all, and one
 * stored before `turn_id` existed cannot say which turn produced it. Neither is
 * fixable by asking the backend again: those conversations are history. So the
 * projection degrades — fewer steps, no anchor — rather than refusing to
 * render, and never invents a step that was not recorded.
 */
import type { StoredMessage, TurnEvent } from './types';

/**
 * A step worth showing.
 *
 * `kind` is the wire kind, kept rather than mapped onto a closed enum: the
 * backend's vocabulary grows, and a step this build does not recognize should
 * appear as an unlabelled line rather than disappear from the timeline.
 */
export interface TimelineStep {
  readonly kind: string;
  readonly role: string | null;
  readonly text: string;
  /** True for a step the reader is meant to read, as opposed to one that only
   * says the machinery moved. */
  readonly substantive: boolean;
  /** A milestone the author marked as such, worth surfacing above progress. */
  readonly milestone: boolean;
}

/**
 * Steps that only report machinery.
 *
 * They are dropped from the timeline rather than styled quietly: a reader
 * scanning a long turn for what the model actually said should not have to skip
 * past a role handshake for every task. `tool_call` is *not* here — what a turn
 * ran is part of what it did.
 */
const MACHINERY: ReadonlySet<string> = new Set(['role_start', 'role_ready', 'session', 'usage']);

/** Steps whose text the reader is meant to read. */
const SUBSTANTIVE: ReadonlySet<string> = new Set([
  'intermediate_output',
  'implementer',
  'decision',
  'final',
  'error',
]);

function textOf(event: TurnEvent): string {
  if (event.kind === 'decision') {
    const action = event.action ?? '';
    const task = event.task ?? '';
    return action === '' ? task : task === '' ? action : `${action}: ${task}`;
  }
  if (event.kind === 'job') return jobText(event);
  return event.text ?? '';
}

/**
 * A managed run, described from its fields.
 *
 * `job` events carry no `text` at all — status, experiment and job id are
 * separate fields — so a projection that only read `text` dropped every
 * simulation the agent started. That is the most consequential thing a turn
 * does, and the reader would have seen the turn go quiet instead.
 */
function jobText(event: TurnEvent): string {
  const status = field(event, 'status');
  const experiment = field(event, 'experimentId');
  const kind = field(event, 'jobKind');
  const what = kind === '' ? 'run' : kind;
  const which = experiment === '' ? field(event, 'jobId') : experiment;
  if (which === '') return status === '' ? '' : `${what}: ${status}`;
  return status === '' ? `${what} ${which}` : `${what} ${which}: ${status}`;
}

/** One passthrough field, when it is a string. */
function field(event: TurnEvent, name: string): string {
  const value = (event as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

/**
 * One event into a step, or null when it carries nothing to show.
 *
 * An event with no text is dropped even when its kind is substantive: an empty
 * line in a timeline says the model produced nothing, which is a different
 * claim from "the model was working".
 */
export function toStep(event: TurnEvent): TimelineStep | null {
  if (MACHINERY.has(event.kind)) return null;
  const note = normalizeNote(textOf(event), event.level ?? null);
  if (note === null) return null;
  return {
    kind: event.kind,
    role: event.role == null || event.role === '' ? null : event.role,
    text: note.text,
    substantive: SUBSTANTIVE.has(event.kind),
    milestone: note.milestone,
  };
}

/**
 * Narration that was recorded as a JSON payload rather than as prose.
 *
 * Older turns wrote `{"action": "...", "message": "..."}` into the text field.
 * Printing that verbatim shows the reader a serialized object; and a payload
 * with only `action`/`task` and no message is bookkeeping that was never meant
 * to be read at all. Both shapes are still in stored conversations and cannot
 * be rewritten, so they are normalized here.
 */
function normalizeNote(
  text: string,
  level: string | null,
): { text: string; milestone: boolean } | null {
  const milestone = level === 'milestone';
  if (text === '') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { text, milestone };
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Not JSON after all — text that merely looks like it. Shown as written.
    return { text, milestone };
  }
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (message !== '')
    return { text: message, milestone: milestone || payload.action === 'milestone' };
  if ('action' in payload || 'task' in payload) return null;
  return { text, milestone };
}

/**
 * The steps of a turn, in order, with each managed run appearing once.
 *
 * A job publishes an event per state change, so a run that queues, starts and
 * finishes would otherwise print three lines that are three views of one thing.
 * The card stays where the run first appeared and carries its latest state:
 * rendering at the newest event instead would march every finished run to the
 * end of the turn, away from the decision that started it.
 */
export function toTimeline(events: readonly TurnEvent[]): TimelineStep[] {
  // Each run collapsed onto the position where it first appeared, carrying its
  // latest state. Keyed by position rather than by run so the second pass has
  // one question to ask — "is there a card at this index?" — instead of two
  // lookups that have to agree with each other.
  const shownAt = new Map<number, TurnEvent>();
  const firstJobAt = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.kind !== 'job') return;
    const key = jobKey(event);
    const at = firstJobAt.get(key) ?? index;
    firstJobAt.set(key, at);
    shownAt.set(at, event);
  });
  return events.flatMap((event, index) => {
    // A job event at a position that holds no card is a later state change for
    // a run already shown further up.
    const shown = event.kind === 'job' ? shownAt.get(index) : event;
    const step = shown === undefined ? null : toStep(shown);
    return step === null ? [] : [step];
  });
}

/**
 * What makes two job events the same run.
 *
 * The resource comes first: one experiment can be extended by several launcher
 * jobs, and those are one thing to a reader.
 */
function jobKey(event: TurnEvent): string {
  return field(event, 'resourceId') || field(event, 'experimentId') || field(event, 'jobId');
}

/**
 * How a turn ended, as a reader needs to tell the endings apart.
 *
 * `input-needed` is not a kind of answer: the turn stopped because it is
 * waiting for the user, and a reader who takes it for an answer will sit
 * watching a conversation that is waiting for them. `failure` is not one
 * either — it asks for a retry, not a reply. `stopped` is the reader's own
 * doing and needs no action from anyone, but it is still not an answer: the
 * text carried is whatever the turn had reached before it was cut off. `none`
 * is a turn that has not ended yet, or one whose record predates the backend
 * naming its ending.
 */
export type TurnOutcome = 'none' | 'answer' | 'input-needed' | 'failure' | 'stopped';

/** A turn as a row: what it did, what it said, and how it ended. */
export interface TurnProjection {
  readonly steps: TimelineStep[];
  /** The answer, or empty while the turn is still working. */
  readonly text: string;
  readonly outcome: TurnOutcome;
}

/** Events that carry a turn's ending rather than its progress. */
const TERMINAL: ReadonlySet<string> = new Set(['done', 'final', 'error']);

/**
 * A running turn as a row.
 *
 * Steps and answer come out of one function so that the answer is absent from
 * the steps by construction. Two functions — one for the timeline, one for the
 * answer — is how the answer came to be printed twice: each was right alone.
 */
export function projectTurn(events: readonly TurnEvent[]): TurnProjection {
  const terminals = events.filter((event) => TERMINAL.has(event.kind));
  const text = lastNonEmpty(terminals);
  return {
    steps: toTimeline(events.filter((event) => !isTheAnswer(event, text))),
    text,
    outcome: terminals.length === 0 ? 'none' : outcomeOf(terminals[terminals.length - 1]),
  };
}

/**
 * A stored assistant message as the same row.
 *
 * The stored `content` wins over whatever the terminal event said, because the
 * store is what survived the turn and the event is a copy of it — one that
 * older builds wrote with the wrappers `unwrap` takes off.
 */
export function projectMessage(message: StoredMessage): TurnProjection {
  // Only an assistant message was ever wrapped, and a user's words are their
  // own: a question that happens to start with `### Orchestrator` is a question
  // that starts with `### Orchestrator`.
  if (message.role !== 'assistant') {
    return { steps: [], text: message.content, outcome: 'none' };
  }
  // Split once, here, and both halves used from this one call. Reading the body
  // twice for opposite purposes is how the halves came to disagree — see
  // `unwrap`.
  const body = unwrap(message.content);
  const text = body.text;
  const activity = message.activity ?? [];
  if (activity.length === 0) {
    return {
      steps: toTimeline(recoveredSteps(message, body.narration)),
      text,
      outcome: text === '' ? 'none' : 'answer',
    };
  }
  const terminals = activity.filter((event) => TERMINAL.has(event.kind));
  return {
    steps: toTimeline(activity.filter((event) => !isTheAnswer(event, message.content))),
    text,
    outcome:
      terminals.length === 0
        ? text === ''
          ? 'none'
          : 'answer'
        : outcomeOf(terminals[terminals.length - 1]),
  };
}

/**
 * The answer, taken from the last terminal event that has one.
 *
 * A turn publishes `final` and then `done` carrying the same text, so reading
 * backwards gives the answer and never an earlier draft. The "that has one"
 * matters because the last frame can arrive empty: a `done` whose payload this
 * build could not parse keeps its framing and loses its fields, and taking the
 * last terminal unconditionally would blank an answer that had already arrived.
 */
function lastNonEmpty(terminals: readonly TurnEvent[]): string {
  for (let index = terminals.length - 1; index >= 0; index -= 1) {
    const text = terminals[index].text ?? '';
    if (text !== '') return text;
  }
  return '';
}

/**
 * What the ending says about itself.
 *
 * Only the backend sets an `outcome`; a role's own `final` has none and is an
 * answer by virtue of being final. The backend names a stopped turn the same
 * way live and stored, so this reads one word rather than two shapes — and a
 * `done` that names nothing at all is left unclassified rather than guessed at,
 * because the same silence would otherwise cover a stop, a turn still in
 * flight, and an ending this reader has never heard of.
 */
function outcomeOf(ending: TurnEvent): TurnOutcome {
  if (ending.kind === 'error') return 'failure';
  if (failed(ending)) return 'failure';
  if (ending.outcome === 'request_user_input') return 'input-needed';
  if (ending.outcome === 'cancelled') return 'stopped';
  // Only the ending this build knows to be an answer counts as one. A `done`
  // that names nothing is what older backends sent for a stop, and one naming
  // an ending added after this reader was written is something this build
  // cannot characterise — calling either an answer puts a reply in front of
  // the reader that nobody made.
  if (ending.kind === 'done' && ending.outcome !== 'final_answer') return 'none';
  return 'answer';
}

/**
 * Whether an ending carries a failure, in either spelling of one.
 *
 * The backend sends `failure` as `{code, message}` on a `done` frame, and
 * `null` when the turn did not fail. Reading it as a string — which is what a
 * shared string-field helper does — found `""` for every real failure and
 * classified it as an ending with no outcome at all: no error styling, and a
 * turn that had failed reported as one that was merely stopped.
 */
function failed(ending: TurnEvent): boolean {
  const failure = (ending as Record<string, unknown>).failure;
  if (typeof failure === 'string') return failure !== '';
  return failure != null;
}

/**
 * The narration of a turn stored before `activity` existed.
 *
 * "No activity" is not "recorded no steps". Those turns recorded their
 * narration in one of two places, and both are still in the store: a separate
 * `intermediate_outputs` list, or — earlier still — inside the message body
 * itself, in the wrapper that `unwrap` takes off. Recovering the second
 * matters because taking the wrapper off is otherwise a deletion: the narration
 * exists nowhere else, and the reader would see an answer with no account of
 * how it was reached.
 */
function recoveredSteps(message: StoredMessage, narration: readonly string[]): TurnEvent[] {
  const separate = (message.intermediate_outputs ?? []).flatMap((output) => {
    const text = output.text ?? '';
    if (text === '') return [];
    return [note(text, output.role ?? 'orchestrator', output.level ?? 'progress')];
  });
  if (separate.length > 0) return separate;
  return narration.map((text) =>
    // Attributed to the orchestrator because that is what both wrappers say it
    // is: one names the class, the other the heading.
    note(text, 'orchestrator', 'progress'),
  );
}

function note(text: string, role: string, level: string): TurnEvent {
  return { kind: 'intermediate_output', role, level, text };
}

const DETAILS = /<details\s+class=["']role-output orchestrator["'][^>]*>([\s\S]*?)<\/details>/gi;
const ORCHESTRATOR_HEADING = '### Orchestrator';
const MESSAGE_HEADING = '### Message\n\n';

/** A stored message body, split into what was narration and what was answered. */
interface Unwrapped {
  readonly narration: readonly string[];
  readonly text: string;
}

/**
 * Take the old wrappers off a stored message body.
 *
 * Assistant messages written by earlier builds embedded the orchestrator's
 * narration in the content itself — a `<details class="role-output">` block, or
 * an `### Orchestrator` preamble ahead of the answer. The narration now has its
 * own place in the timeline, so leaving a wrapper in would print it twice and
 * bury the answer under a heading that means nothing to a reader today.
 *
 * Both halves come out of one call, and `projectMessage` makes that call once.
 * Two readers of the same text, each taking the half it wanted, is how the
 * duplication got in: a preamble with no section after it is the whole message,
 * and the reader that wanted narration counted it while the reader that wanted
 * the answer kept it — so it appeared as a step *and* as the answer below it.
 *
 * This runs on stored history only. Nothing writes these shapes any more, and
 * nothing can rewrite the conversations that contain them.
 */
function unwrap(content: string): Unwrapped {
  const narration: string[] = [];
  for (const match of content.matchAll(DETAILS)) {
    const inner = match[1].replace(/<summary>[\s\S]*?<\/summary>/gi, '').trim();
    if (inner !== '') narration.push(inner);
  }
  const rest = content.replace(DETAILS, '').trimStart();
  if (!rest.startsWith(ORCHESTRATOR_HEADING)) return { narration, text: unlabel(rest) };
  const body = rest.slice(ORCHESTRATOR_HEADING.length);
  const next = firstSection(body);
  // Nothing follows the preamble, so it is not a preamble: there is no answer
  // it precedes, and the message is what it says. Kept whole, heading included,
  // because cutting a heading off the only text there is would leave a reader
  // wondering what was removed.
  if (next === undefined) return { narration, text: unlabel(rest) };
  const preamble = body.slice(0, next.index).trim();
  if (preamble !== '') narration.push(preamble);
  return {
    narration,
    // `### Message` labels the answer and goes with the preamble; the other
    // markers name content the reader still wants, so their headings stay.
    text: unlabel(
      next.keepHeading ? body.slice(next.index + 2) : body.slice(next.index + next.marker.length),
    ),
  };
}

function unlabel(text: string): string {
  return (text.startsWith(MESSAGE_HEADING) ? text.slice(MESSAGE_HEADING.length) : text).trimStart();
}

/**
 * Whether a step is the answer being said a second time.
 *
 * The backend appends the final text to the activity list *and* stores it as
 * the message's `content` (`_run_browser_turn` in the conversation backend), so
 * a timeline that keeps it prints the answer twice, which reads as the model
 * repeating itself. Dropping `done` alone is not enough: the stored spelling is
 * a `final` step, or an `error` step when the turn failed.
 *
 * Matching on the text rather than on the kind is deliberate. A `final` step
 * that says something *other* than the answer is not a repetition, and dropping
 * it would delete part of the record.
 */
function isTheAnswer(event: TurnEvent, answer: string): boolean {
  if (!TERMINAL.has(event.kind)) return false;
  // `done` is the stream's own end frame rather than a step of the turn, so it
  // is never part of the record whatever it says.
  if (event.kind === 'done') return true;
  return (event.text ?? '') === answer;
}

/** Where the orchestrator preamble ends: the earliest section heading after it. */
function firstSection(
  text: string,
): { marker: string; keepHeading: boolean; index: number } | undefined {
  const markers = [
    { marker: '\n\n### Implementer Summary\n\n', keepHeading: true },
    { marker: '\n\n### Message\n\n', keepHeading: false },
    { marker: '\n\n### Error\n\n', keepHeading: true },
  ];
  return markers
    .map((candidate) => ({ ...candidate, index: text.indexOf(candidate.marker) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index)[0];
}

/** The role currently answering, or null before any role has started. */
export function activeRole(events: readonly TurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const role = events[index].role;
    if (role != null && role !== '') return role;
  }
  return null;
}

/**
 * What names a stored message, for deduplication and for React keys.
 *
 * The backend publishes each message's own id, so a page arriving late cannot
 * duplicate a message already on screen even if the conversation grew between
 * the two reads. Messages without an id — written before the backend published
 * one — fall back to their position, which is stable because the store is
 * append-only. The two spellings are kept apart so that the id `3` and the
 * third message of a conversation that has no ids cannot be taken for each
 * other.
 *
 * One function because the merge and the row keys must agree: a merge that
 * treats two rows as one message while the list treats them as two shows the
 * reader a duplicate that no refetch clears.
 */
export function messageIdentity(message: StoredMessage, position: number): string {
  return message.id === undefined ? `@${position}` : `#${message.id}`;
}

/**
 * Merge a page of older messages into the ones already held.
 *
 * Identity, not position — see `messageIdentity`. A page arriving late cannot
 * duplicate a message already on screen even if the conversation grew between
 * the two reads.
 */
export function mergeEarlier(
  earlier: readonly StoredMessage[],
  current: readonly StoredMessage[],
  earlierStartIndex: number,
  currentStartIndex: number,
): StoredMessage[] {
  const seen = new Set<string>();
  const merged: StoredMessage[] = [];
  const push = (message: StoredMessage, position: number) => {
    const key = messageIdentity(message, position);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(message);
  };
  earlier.forEach((message, offset) => push(message, earlierStartIndex + offset));
  current.forEach((message, offset) => push(message, currentStartIndex + offset));
  return merged;
}
