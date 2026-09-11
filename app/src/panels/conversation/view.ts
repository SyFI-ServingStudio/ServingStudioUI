/**
 * A session's state as rows a component can render.
 *
 * Display only: ordering, labelling, keys, and the one sentence that says what
 * the session is doing. Nothing here fetches, and nothing here decides what a
 * turn *is* — `session/projection.ts` owns that, and this module arranges what
 * it produces.
 *
 * The reason it exists at all is the seam between two lists that render as one:
 * the messages the backend has stored, and the events of the turn still
 * running. A reader sees a single conversation, so the join has to be a pure
 * function that a test can hold still.
 */
import {
  activeRole,
  messageIdentity,
  projectMessage,
  projectTurn,
  type TimelineStep,
  type TurnOutcome,
} from '../../session/projection';
import type { SessionState, StoredMessage } from '../../session/types';

export interface ConversationRow {
  /** Stable across reloads: the backend's row id where there is one. */
  readonly key: string;
  readonly role: string;
  /** The answer, or the user's words. Empty while a turn is still working. */
  readonly text: string;
  /** What the turn did on the way to `text`. Empty for a user message. */
  readonly steps: readonly TimelineStep[];
  /** How the turn ended, so a row that is waiting on the reader says so. */
  readonly outcome: TurnOutcome;
  /** True for the turn in flight — the row that is still being written. */
  readonly live: boolean;
}

/**
 * Stored messages, then the turn in flight.
 *
 * The live row is appended rather than merged into the last message because
 * they are different claims: a stored assistant message is what the backend
 * kept, and the live row is what this browser has heard so far. When the turn
 * lands the controller refetches, the live row goes away and a stored one takes
 * its place — a different row with a different key, which is correct: they are
 * not the same thing, and pretending otherwise would keep the live row's scroll
 * position and state on a message that has since been rewritten by the store.
 */
export function conversationRows(state: SessionState): ConversationRow[] {
  const rows = state.messages.map((message, offset) =>
    storedRow(message, state.startIndex + offset),
  );
  if (state.live.length === 0) return rows;
  const turn = projectTurn(state.live);
  rows.push({
    key: 'live',
    role: activeRole(state.live) ?? 'assistant',
    text: turn.text,
    steps: turn.steps,
    outcome: turn.outcome,
    live: true,
  });
  return rows;
}

function storedRow(message: StoredMessage, position: number): ConversationRow {
  const turn = projectMessage(message);
  return {
    key: messageIdentity(message, position),
    role: message.role,
    text: turn.text,
    steps: turn.steps,
    outcome: turn.outcome,
    live: false,
  };
}

/**
 * What the session is doing, in words a reader can act on.
 *
 * `detached` and `streaming` say different things on purpose: one means this
 * browser is listening to a turn, the other that it is not listening and
 * cannot say whether anything is running. Both are normal; conflating them
 * would leave a reader unable to tell a finished conversation from an unheard
 * one, which is why the `detached` sentence says "any turn it is running"
 * rather than naming one.
 */
export function statusNote(state: SessionState): string | null {
  switch (state.status) {
    case 'idle':
      return null;
    case 'loading':
      return 'Loading this conversation…';
    case 'streaming':
      return 'Working…';
    case 'cancelling':
      // Deliberately not "the agent has been told to stop". The request goes
      // out immediately, but the server holds it until the role handoff the
      // turn is inside completes — and if the message that started the turn had
      // not yet been accepted, that first request can find nothing to stop and
      // a second one follows once it has. Claiming the turn is over when it is
      // not is the kind of small lie that makes a reader press Stop again.
      return 'Stopping this turn at the first point it can be interrupted safely.';
    case 'detached':
      return 'Not listening to this conversation. Any turn it is running continues on the server.';
    case 'failed':
      return 'This conversation could not be loaded.';
  }
}
