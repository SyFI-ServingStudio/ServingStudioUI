/**
 * One conversation's live state, and the operations that change it.
 *
 * A `SessionController` is a plain object with a subscribe/getState pair — not
 * a hook, not a React context value — because its lifetime is not a component's.
 * A conversation survives being undocked, re-docked, and navigated past on the
 * way to another result. Reattaching would not lose the turn's *events* — the
 * backend replays a running turn from its start — but it would re-read the
 * history on every dock, and it would drop what only this browser knows: the
 * message posted but not yet stored, and a Stop the reader has already asked
 * for and is waiting on.
 *
 * Controllers are indexed by `(workspace, conversation)` in a module-level
 * registry for the same reason. Two panels showing the same conversation are
 * two views of one session, not two sessions.
 *
 * ## Two ways to stop, and they are not the same
 *
 * `detach()` drops this browser's subscription. The turn keeps running on the
 * server, and `attach()` picks it up again.
 *
 * `interrupt()` asks the server to stop and waits for it to confirm. It is the
 * only one that ends work.
 *
 * Merging them would mean either that closing a panel kills a turn the user
 * wanted, or that a runaway turn survives because a tab closed. They stay
 * separate.
 *
 * ## Late responses
 *
 * Every operation that invalidates work in flight runs under a generation
 * number, and a response — a page of history, a stream event — is applied only
 * if its generation is still current. Without that, a slow first load landing
 * after the user has already sent a message would replace the live turn with
 * the history that predates it.
 *
 * Two things outlive a connection and therefore carry an identity of their own.
 * A **Stop** belongs to the turn rather than to the connection that asked for
 * it: reattaching does not withdraw one, and an answer discarded because the
 * connection changed would leave the session saying `cancelling` with nothing
 * left to correct it. A **send** belongs to the message: its outcome is news
 * whether or not a reload has taken the session over in the meantime, because
 * the reader watched that message leave the composer and nothing else on the
 * page will account for it.
 *
 * So there are three lifetimes here and they are deliberately separate — the
 * connection's generation, the send attempt, and the Stop. Anything that
 * confuses two of them shows up as a message with no visible fate, or as a Stop
 * landing on a turn it was not about.
 */
import { cancelTurn, describeError, getConversation, SessionApiError } from './api';
import { mergeEarlier } from './projection';
import { openTurnStream, resumeTurnStream, toTurnEvent, type RawStreamEvent } from './stream';
import {
  doneEventSchema,
  idleState,
  sessionKey,
  type SessionRef,
  type SessionState,
  type StoredMessage,
  type TurnEvent,
} from './types';

const PAGE_SIZE = 50;

/**
 * How a lost connection is retried before the reader is asked to.
 *
 * A turn stream that ends without `done`, stalls, or errors has lost the
 * connection, not the turn: the turn runs on the server either way. Waiting for
 * the reader to notice and press Reattach is how a running turn sat frozen on
 * screen for most of an hour. `attempts` counts reconnects in a row with no
 * event between them, so a connection that keeps dying on arrival still ends in
 * `detached`/`failed` rather than a loop. Mutable for tests only.
 */
export const RECONNECT = { attempts: 3, delayMs: 1_000 };

/** A turn's events, as they arrive. */
type TurnStream = AsyncGenerator<RawStreamEvent>;

/**
 * A message that has left this browser and has not been answered.
 *
 * The connection is carried with the promise because the two are only sometimes
 * the same thing to release. `release` waits for an unanswered POST rather than
 * aborting it — the request may not have reached the backend, and aborting
 * would destroy the message outright — but that is a reason to keep *this*
 * socket, not whichever socket happens to be open now. Reattaching in the
 * meantime replaces it with a GET, and holding that open behind an unrelated
 * POST leaks a subscription per reattach.
 */
interface PendingPost {
  readonly promise: Promise<void>;
  readonly connection: AbortController;
  /**
   * The turn the backend started for this message, once it has said which.
   *
   * `null` until then, and `null` afterwards for a backend that names none.
   * A Stop that has to be re-sent uses it to say *which* turn it means —
   * `/cancel` addresses the conversation, so without it a retry lands on
   * whatever is running by the time it goes out.
   */
  turnId: string | null;
  /**
   * Whether the backend answered this message by starting a turn.
   *
   * The promise settles either way — on acceptance, on refusal, and on a
   * connection that died without an answer — so it says only that the wait is
   * over. Whether there is now a turn *this browser started* is a different
   * question, and it is the one a Stop has to ask before asking again: the
   * `/cancel` route is conversation-scoped, so a second request stops whatever
   * is running by then, which need not be anything this reader sent.
   */
  accepted: boolean;
}

/** The backend's answer when a turn is already running in this conversation. */
const CONFLICT = 409;

/**
 * Why the composer is closed on a session that reads idle.
 *
 * A constant because it is both written and withdrawn — put up when a reload
 * lands while this browser's own message is still in flight, taken down the
 * moment that message is acknowledged.
 */
const UNACKNOWLEDGED =
  'Your message has been sent but the backend has not acknowledged it yet. The composer reopens as soon as it does.';

/**
 * A message the backend refused because the conversation was already busy.
 *
 * Unlike a transport failure, this one is a fact: the refusal is issued before
 * anything is stored, so the message really did not happen.
 */
const CONFLICTED = 'This conversation already has a turn running, so that message was not sent.';

/** What the server answers a Stop with when the turn is already over. */
const NOTHING_TO_STOP = 'That turn had already ended, so there was nothing to stop.';

/**
 * A Stop the reader has asked for, and the turn it was asked about.
 *
 * Kept because the answer outlives the connection: the request is with the
 * server, and a panel that closes and reopens has to come back saying the turn
 * is stopping rather than saying it is working.
 *
 * An object rather than a flag, because a Stop needs two things a flag cannot
 * carry. It needs an identity of its own, since the connection's generation is
 * the wrong one — reattaching in the middle of a Stop does not withdraw it — so
 * an answer tied to the generation was thrown away exactly when it mattered,
 * leaving the session saying `cancelling` with nothing left to correct it. One
 * of these is made per Stop and compared by reference, so the identity is the
 * object and no two are ever confused.
 *
 * And it needs to say what it was asked about, because `cancelling` is a claim
 * about the turn on screen and the two can come apart — see `turnId`.
 */
interface Cancellation {
  /**
   * The turn this Stop is for, once there is one to name.
   *
   * Written twice, because a Stop can be asked for before its target exists:
   * the composer offers Stop from the moment a message leaves, and the turn
   * that message becomes is named on the POST's response head. Until then this
   * is `null` and the Stop is unaddressed — which is not the same as a Stop
   * that will never have a name, and the two are told apart by whether a
   * message is still unanswered rather than by this field alone.
   *
   * `null` is also all a backend that names no turns ever gives, and there it
   * keeps the meaning it always had: the request was a wildcard, so "whatever
   * is running" is still whatever is running after a reconnect.
   */
  turnId: string | null;
}

/** No message of this browser's is in doubt. Also where `clock` starts. */
const RESOLVED = 0;

export type Unsubscribe = () => void;

export interface SessionController {
  readonly ref: SessionRef;
  getState(): SessionState;
  subscribe(listener: () => void): Unsubscribe;
  /** Load history and reattach to any turn already running. Idempotent. */
  attach(): void;
  /** Drop this browser's subscription. Does not stop the turn. */
  detach(): void;
  send(text: string, options?: Record<string, unknown>): Promise<void>;
  /** Whether a message can be sent right now. The controller decides, not a view. */
  canSend(): boolean;
  /** Ask the server to stop the running turn, and wait for confirmation. */
  interrupt(): Promise<void>;
  loadEarlier(): Promise<void>;
  /** Register a view. Attaches on the first one. */
  observe(): Unsubscribe;
}

class Controller implements SessionController {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every operation that invalidates in-flight work. */
  private generation = 0;
  private stream: AbortController | null = null;
  private attached = false;
  private loadingEarlier = false;
  /**
   * A Stop the reader has asked for, kept until the turn is over.
   *
   * Deliberately not cleared by `detach` or `reload`. Closing a panel is not
   * changing one's mind, and a reconnection that forgot would leave the reader
   * watching a turn they had already stopped. What a reconnection does check is
   * that the turn it came back to is the turn that was stopped.
   */
  private cancellation: Cancellation | null = null;
  /**
   * The turn this browser is streaming, as the backend named it.
   *
   * `/cancel` addresses the conversation, not the turn, so a Stop sent without
   * a name stops whatever is running when it arrives — which need not be the
   * turn the reader was looking at when they pressed it. Another tab starting a
   * turn is enough for the two to differ, and the reader who is stopped is then
   * the one who did nothing.
   *
   * Set wherever a stream is opened — the POST that starts a turn and the GET
   * that reattaches to one — and `null` for a backend that names none, which is
   * where the old meaning survives: a Stop with nothing to name still means
   * whatever is running.
   */
  private turn: string | null = null;
  /**
   * When a message left this browser and its fate became unknown.
   *
   * Not the same as `pendingPost`, which is a message still in flight: this is
   * one whose answer was lost — the connection died, or a reload took the
   * session over before the response came back. The conversation may be running
   * a turn for it or may never have seen it, and this browser cannot tell.
   *
   * It closes the composer, because the one thing that must not happen is a
   * second copy of the question landing on a conversation already answering the
   * first.
   *
   * A moment rather than a flag, because of what it takes to retire it. Only a
   * read *asked for after* this moment can: the backend stores the message and
   * registers its turn before it flushes the response head that went missing,
   * so a request sent afterwards finds them, while one already in flight is
   * being answered from a conversation as it stood before the message — and it
   * can truthfully come back with no sign of it and no turn running. Retired on
   * arrival rather than on order, a history read that merely overlapped the
   * send reopened the composer over a turn already being answered.
   */
  private unresolvedAt = RESOLVED;
  /**
   * Ticks, so that "this read was asked for after that happened" is decidable.
   *
   * The generation cannot answer it: it moves when work is invalidated, and the
   * reads that matter here — the history page inside a reload, the refetch when
   * a turn ends — happen under one that is not moving.
   */
  private clock = RESOLVED;
  /**
   * The message this browser has sent and not yet heard back about.
   *
   * `null` means there is none outstanding — one field rather than a promise
   * beside a flag, because "is one in flight" and "which one" are the same fact
   * and two fields can disagree about it. It is also the token of ownership:
   * only the send whose own record is still here may clear it, which `send`
   * gets by settling exactly once — the POST's outcome and the stream that
   * follows it are two separate blocks there, precisely so that a stream
   * failing later cannot announce that some *other* message has arrived.
   *
   * What it marks is a window of *ignorance*, not of inaction. The backend
   * registers a turn before it answers, so by the time this settles the turn may
   * have been running for a while; and it settles on refusal and on a connection
   * that died with no answer, where there may be no turn — or may be one this
   * browser will never hear about. Either way, what changes at that moment is
   * only that this browser has stopped waiting. Whether a turn exists is
   * `accepted`, which is a narrower claim and the only one a Stop may act on.
   *
   * Two things depend on that window, and both are about answers taken during it
   * being out of date rather than wrong:
   *
   * - A Stop clicked here — the composer offers one as soon as the message
   *   leaves — can reach a backend that has not read the message yet and be told
   *   truthfully that there was nothing to stop. `cancel` waits on this and asks
   *   again.
   * - A reload here asks what is running and is told nothing is. `canSend`
   *   consults this so the composer does not reopen on that answer: sending
   *   again would put two messages in flight for one conversation, and the loser
   *   of that race is a question the reader typed and never sees answered.
   */
  private pendingPost: PendingPost | null = null;
  /** How many views are watching. The subscription lives while this is > 0. */
  private observers = 0;
  /** Reconnects since the last event arrived. See `RECONNECT`. */
  private reconnects = 0;

  constructor(readonly ref: SessionRef) {
    this.state = idleState(ref);
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private current(generation: number): boolean {
    return this.generation === generation;
  }

  /** The next moment. Every one is later than every moment before it. */
  private now(): number {
    return (this.clock += 1);
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.reconnects = 0;
    void this.reload();
  }

  /**
   * Reopen a connection that was lost while a turn was being read.
   *
   * False when it is not this method's to do — nobody is watching, or the
   * budget is spent — and the caller then reports the loss as before. True
   * otherwise, including when a newer operation took the session over during
   * the wait: that operation owns what is on screen, and there is nothing left
   * here to do.
   */
  private async reconnect(generation: number): Promise<boolean> {
    if (!this.attached || this.reconnects >= RECONNECT.attempts) return false;
    this.reconnects += 1;
    await new Promise((resolve) => setTimeout(resolve, RECONNECT.delayMs * this.reconnects));
    if (!this.current(generation) || !this.attached) return true;
    // `reload` asks what is running and replays it from the start, so an event
    // that arrived while the connection was dead is not lost; and if the turn
    // ended meanwhile, the history it reads is the answer.
    await this.reload();
    return true;
  }

  /**
   * One view starts watching; the returned function says it stopped.
   *
   * Reference counting rather than "whoever closes, detaches": two panels can
   * show one conversation, and closing the first must not silence the second.
   * The controller itself survives either way — what is released here is the
   * connection, not the session, and reattaching replays the turn from its
   * start, so letting go costs nothing but the socket.
   */
  observe(): Unsubscribe {
    this.observers += 1;
    this.attach();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.observers -= 1;
      if (this.observers === 0) this.detach();
    };
  }

  /**
   * True when this conversation is free to take a message.
   *
   * `idle` and nothing else. `loading` is busy because whether a turn is
   * already running is exactly what has not been answered yet; `failed` is busy
   * because the last thing this browser knows about the conversation is that it
   * could not read it — sending into that would post a message against a state
   * we have no picture of, and the 409 path exists for the case where we
   * thought we knew and were wrong. A failed session reattaches first.
   *
   * `idle` is necessary and not sufficient: a session can read `idle` while
   * this browser's own message is still on its way to the backend. See
   * `pendingPost` for why, and for what a second message costs there.
   */
  canSend(): boolean {
    return (
      this.getState().status === 'idle' &&
      this.pendingPost === null &&
      this.unresolvedAt === RESOLVED
    );
  }

  detach(): void {
    // Only the subscription. The turn is the server's, and it keeps running —
    // as does a Stop already asked for, which is why `cancellation` survives.
    this.release();
    // `loading` counts: a read that was going to say what is running has been
    // let go of too, and leaving the session saying "loading" would describe a
    // request that nobody is waiting for any more.
    const pending: readonly SessionState['status'][] = ['streaming', 'cancelling', 'loading'];
    if (pending.includes(this.state.status)) this.set({ status: 'detached' });
  }

  /** Let go of the connection without claiming anything about the turn. */
  private release(): void {
    this.attached = false;
    // Whatever turn this connection was reading, this browser is no longer
    // reading it. No path observes a stale name today — every way back to a
    // status where Stop is offered goes through `reload`, which reads a fresh
    // one — so this is the field's lifetime written down rather than a case
    // being handled: the name belongs to the connection and does not outlive
    // it.
    this.turn = null;
    this.drop();
  }

  /**
   * Let go of whatever connection is installed, keeping `attached` as it is.
   *
   * Every place that installs a connection has to do this first, or the one it
   * replaces is abandoned rather than closed — a socket nobody will ever abort,
   * one per reattach, against the browser's per-host budget. Written once
   * because the rule has an exception (below) and two copies of an exception is
   * one copy too many.
   */
  private drop(): void {
    const stream = this.stream;
    this.stream = null;
    if (stream === null) return;
    const posting = this.pendingPost;
    if (posting !== null && posting.connection === stream) {
      // A message that has left but has not been answered is not yet the
      // server's, and aborting it can destroy it outright: the request may not
      // have reached the backend at all, and what the reader would find on
      // coming back is an empty conversation with no account of where their
      // question went. Letting go waits for the answer — at which point the
      // turn belongs to the server, which keeps running it, and dropping the
      // socket costs nothing but the replay on reattaching.
      //
      // Only for that message's own connection. Anything else here is a read
      // this browser opened, and a read has nothing to lose by being dropped.
      void posting.promise.then(() => stream.abort());
      return;
    }
    stream.abort();
  }

  /**
   * Find out what is running, then read the history, then listen.
   *
   * That order is the point. Reading history first leaves a window: a turn that
   * finishes between the two answers is absent from the history (it had not
   * been stored yet) and absent from the stream (204 — it is over), so its
   * answer would never appear at all. Asking `/stream` first makes the window
   * harmless, because anything that ends after that answer is either replayed
   * to us or already in the history we are about to read.
   *
   * @param notice a message to keep through the reload, for the caller that is
   * reloading *because* something went wrong and needs to say so.
   */
  private async reload(notice: string | null = null): Promise<void> {
    const generation = (this.generation += 1);
    this.set({ status: 'loading', error: notice });
    this.drop();
    this.turn = null;
    const abort = new AbortController();
    this.stream = abort;
    let events: TurnStream | null = null;
    let unanswered: unknown = null;
    try {
      const opened = await resumeTurnStream(this.ref, abort.signal);
      events = opened === null ? null : opened.events;
      this.turn = opened === null ? null : opened.turnId;
    } catch (error) {
      // A broken stream endpoint must not cost the reader the conversation, so
      // this is recorded and the history read goes ahead.
      unanswered = error;
      if (this.current(generation) && !abort.signal.aborted) {
        this.set({ error: describeError(error) });
      }
    }
    if (!this.current(generation)) return;
    // The read carries this connection's signal, which is what makes detaching
    // stop it: detaching does not bump the generation — it invalidates nothing,
    // it just stops listening — so without the signal a history read landing
    // after the last view closed would announce `streaming` over a connection
    // that has already been let go.
    if (!(await this.refresh(generation, notice, abort.signal))) return;
    if (events === null) {
      if (unanswered !== null) {
        // Not knowing whether a turn is running is not the same as knowing
        // there is none. Reading it as idle re-enables the composer, and the
        // message then lands on a conversation that is already working — the
        // 409 path, reached by a route the reader had no way to anticipate.
        // The history read above still stands: what is stored is on screen,
        // and what is offered is Retry rather than a composer.
        this.fail(unanswered);
        return;
      }
      // Nothing is running — as far as the backend has read. This browser's
      // own message may still be on its way there, and then this answer
      // predates the turn it is being taken to describe. Two things follow.
      //
      // A Stop the reader has already asked for is *not* withdrawn. It was sent
      // while the message was in flight, so the backend truthfully answered
      // that it had nothing to stop; the retry that covers exactly that race
      // waits on the message, and clearing the Stop here makes that retry
      // decide it is no longer the outstanding one and give up. The turn then
      // runs on, unstoppable, having been stopped.
      if (this.pendingPost === null) this.cancellation = null;
      // Nor is a message still in doubt settled by this. The flag is still up
      // only because the history that came back was asked for before that
      // message left — see `unresolvedAt` — and this 204 is the same
      // connection's answer to the same out-of-date question: nothing was
      // running *then*. Taken as an answer it produces exactly the wrong page,
      // an idle conversation with an open composer over a turn that is being
      // answered right now.
      //
      // So it asks again, with requests that postdate the message. Once, not in
      // a loop: the reads this starts do postdate it, so whatever they find
      // retires the flag, and a reload that fails leaves the session `failed`
      // rather than back here.
      if (this.unresolvedAt !== RESOLVED) {
        await this.reload(this.state.error);
        return;
      }
      // And the composer stays shut — see `pendingPost` — which without a word
      // between them leaves the reader typing into a box that will not send,
      // under a status chip saying nothing is happening. Said as a note rather
      // than a status, because it is not one: the conversation really is idle,
      // and there is nothing here to retry or reattach to.
      this.set({
        status: 'idle',
        error: this.pendingPost === null ? this.state.error : UNACKNOWLEDGED,
      });
      return;
    }
    if (!this.current(generation)) return;
    // A Stop asked for before the connection changed is not re-sent: it is
    // already with the server, and saying so is all this browser owes it.
    //
    // But `cancelling` is a claim about the turn on the other end of *this*
    // connection, and that need not be the turn that was stopped. A reader who
    // stops one turn, closes the panel, and comes back to another — the next
    // one in the conversation, or another tab's — would be shown a turn they
    // never touched already stopping, with Stop disabled and nothing left that
    // could correct it: the only answer still coming is about the turn before,
    // and an affirmative for that one says nothing about this one. So the Stop
    // is carried onto the turn it named and no other.
    //
    // A Stop still waiting for a name is exempt, and has to be. It is waiting
    // because this browser's own message has not been acknowledged yet, so
    // there is nothing to compare it against; the retry that finally sends it
    // names whatever that message became. Withdrawing it here would throw away
    // the one Stop that exists precisely because it could not be aimed.
    const stop = this.cancellation;
    if (stop !== null && this.pendingPost === null && stop.turnId !== this.turn) {
      this.cancellation = null;
    }
    this.set({ status: this.cancellation === null ? 'streaming' : 'cancelling', live: [] });
    try {
      await this.consume(events, generation, abort.signal);
    } catch (error) {
      // A dropped connection rejects the read. Aborting is this browser's own
      // doing and says nothing; anything else is worth reporting, once
      // reconnecting has been tried.
      if (abort.signal.aborted || !this.current(generation)) return;
      if (await this.reconnect(generation)) return;
      this.fail(error);
    }
  }

  /**
   * Send a message, if this conversation is free to take one.
   *
   * The refusal lives here rather than in whatever is rendering: a second
   * caller — another panel on the same conversation, a keystroke that raced the
   * disable — would otherwise bump the generation, abort the first caller's
   * stream and post a turn the backend will reject with a 409.
   */
  async send(text: string, options: Record<string, unknown> = {}): Promise<void> {
    if (!this.canSend()) return;
    const generation = (this.generation += 1);
    // Sending is attaching. A draft conversation sends its first message before
    // any panel has mounted, and without this the panel's `attach()` would then
    // reload history over the turn that send had just started.
    this.attached = true;
    // A new turn cannot inherit the previous one's Stop.
    this.cancellation = null;
    this.drop();
    const abort = new AbortController();
    this.stream = abort;
    // Set before the first `await`, so a second `send` in the same tick — two
    // panels on one conversation — is refused by `canSend` rather than
    // overwriting this one.
    let arrived = () => {};
    const posting: PendingPost = {
      promise: new Promise<void>((resolve) => {
        arrived = resolve;
      }),
      connection: abort,
      accepted: false,
      turnId: null,
    };
    this.pendingPost = posting;
    const answered = () => {
      // Cleared without asking whether this send still owns the field, because
      // no other send can have taken it: `canSend` refuses while one is
      // outstanding, and the refusal and the assignment above are in the same
      // synchronous stretch. Exactly one of the two branches below calls this,
      // so it runs once per send.
      this.pendingPost = null;
      // And the note explaining why the composer was closed has stopped being
      // true. Left up, it would tell a reader mid-conversation that a message
      // from some earlier moment is still unacknowledged.
      if (this.state.error === UNACKNOWLEDGED) this.set({ error: null });
      arrived();
    };
    // Shown immediately and not waited for: the user's own words are not in
    // doubt, and a composer that clears only after a round trip feels broken on
    // a slow link. The refetch after the turn replaces this with the stored row.
    const pending: StoredMessage = { role: 'user', content: text };
    this.set({
      messages: [...this.state.messages, pending],
      live: [],
      status: 'streaming',
      error: null,
    });
    // Two blocks, not one `try`. The first is about the message — did the
    // backend take it, and what does the reader need to be told — and the second
    // is about the connection its answer arrived on, which can fail much later
    // for reasons that say nothing about the message. Together they were one
    // `catch` reached twice per send, and a second settlement is a claim about
    // whichever message is outstanding *by then*, which need not be this one.
    let events: TurnStream;
    try {
      const opened = await openTurnStream(this.ref, { ...options, text }, abort.signal);
      events = opened.events;
      // Both before `answered`, which is what a waiting Stop is released by: the
      // Stop's retry reads these to decide whether it has a turn to stop, and
      // which one.
      posting.turnId = opened.turnId;
      posting.accepted = true;
      // And on the session, which is what a *later* Stop reads: this is now the
      // turn on screen, whatever becomes of the record of the send.
      this.turn = opened.turnId;
      answered();
    } catch (error) {
      answered();
      // This send's own abort: the panel closed, and `release` waited for this
      // answer before dropping the socket. Nothing happened that is worth
      // reporting to a reader who is no longer there.
      if (abort.signal.aborted) return;
      if (error instanceof SessionApiError && error.status === CONFLICT) {
        // The conversation already has a turn running — started in another tab,
        // or by this one before its own subscription had answered. The backend
        // refuses *before* storing anything, so the optimistic row is a message
        // that was never sent, and leaving it on screen would show the user a
        // question the agent will never answer.
        //
        // Taking it back happens here rather than as a side effect of the
        // reload that follows: the reload can itself fail, and a rollback that
        // depended on a successful read would leave the rejected message on
        // screen in exactly the case where the reader can least explain it.
        this.set({ messages: this.state.messages.filter((message) => message !== pending) });
        // Only if someone is still watching. `release` defers this send's abort
        // behind its own answer, so a refusal that arrives after the last panel
        // closed reaches here with nothing attached — and reloading would open
        // a stream that no view is holding a lease on and none can release. The
        // reader gets the running turn from the reload `attach` does anyway.
        if (!this.attached) {
          this.set({ error: CONFLICTED });
          return;
        }
        await this.reload(`${CONFLICTED} Showing the turn in progress.`);
        return;
      }
      if (!this.current(generation)) {
        // A reload has taken the session over. The failure still belongs to a
        // message the reader typed and watched leave the composer, so it is
        // said — as a note, because the status now describes the reload's
        // reading of the conversation rather than this send, and overwriting it
        // would replace a conversation that loaded fine with a session that
        // says it is broken.
        //
        // And it is said as an unknown rather than as a refusal. A response
        // that never arrived is not a message that never arrived: the backend
        // may have taken the turn and lost the answer on the way back, and a
        // reader told flatly that it was not sent will send it again — landing
        // a second copy of the same request on a conversation already running
        // the first. The 409 above is the case that *is* a refusal, and it says
        // so; this one only says what this browser knows.
        // And the composer stays shut until something finds out. Reopened, the
        // session reads idle and sendable on a conversation that may be
        // answering the very message this branch could not confirm — and the
        // reader, told to reload and given a working composer instead, types it
        // again.
        const note = `That message may not have reached the backend: ${describeError(error)}`;
        if (this.attached && this.getState().status === 'idle') {
          // Ask, rather than telling the reader to ask. The question has one
          // answer and one way to get it, and the reader has no button that
          // does it: Retry and Reattach belong to `failed` and `detached`, and
          // this is neither — the conversation read fine, it is only this
          // message's fate that is open. Left as a note over a shut composer it
          // is a session that never sends again.
          await this.reload(`${note} Reading the conversation to see whether it took the turn.`);
          return;
        }
        // Nobody is watching, or a turn is on screen — in which case its own
        // ending refetches the history, and that read is the answer. Or a
        // reload is already in flight, which is not the same thing: its reads
        // went out before this message did, so it will have to ask again rather
        // than take what they bring back as the answer.
        //
        // Until one of those happens the composer stays shut, because reopening
        // it would invite a second copy of a message that may already be being
        // answered. Recorded as *when* this browser stopped knowing, so that a
        // read can be compared with it.
        this.unresolvedAt = this.now();
        this.set({ error: `${note} Reload to see whether it took the turn.` });
        return;
      }
      this.fail(error);
      return;
    }

    if (!this.current(generation)) {
      // A reload took the session over while the backend was still deciding —
      // nothing else can, because no second message may be sent while this one
      // is unanswered — and it asked what was running and was told nothing was.
      // That was true when it was said and is out of date now: the turn exists.
      // Its events cannot be consumed here, because this connection is no
      // longer the session's, so the answer is to reattach, which replays the
      // turn from its start. Returning quietly instead leaves the reader on an
      // idle page with their message nowhere on it while the agent answers it.
      abort.abort();
      if (this.attached) await this.reload();
      return;
    }

    try {
      await this.consume(events, generation, abort.signal);
    } catch (error) {
      // Past here the message is the server's and its outcome has already been
      // reported. What can go wrong now is the connection, and a connection
      // this browser abandoned — by aborting it, or by reloading past it — is
      // not news for anyone.
      if (abort.signal.aborted || !this.current(generation)) return;
      if (await this.reconnect(generation)) return;
      this.fail(error);
    }
  }

  private async consume(
    events: TurnStream,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    let ended = false;
    // A reattach replays the whole running turn in one burst, hundreds of
    // events at once. Publishing each one re-rendered the transcript per event
    // and froze the page for seconds on the turn's opening lines. Events that
    // arrive together are published together; the timer fires once the burst
    // has been read, and a live event on its own still shows at once.
    let pending: TurnEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = null;
      const batch = pending;
      pending = [];
      if (batch.length > 0 && this.current(generation)) {
        this.set({ live: [...this.state.live, ...batch] });
      }
    };
    try {
      for await (const raw of events) {
        if (!this.current(generation)) return;
        // The *framing* decides that the turn ended, not the payload. A `done`
        // this build cannot read is still a turn that finished, and treating an
        // unreadable one as "no end yet" is how a finished conversation gets
        // stuck saying it is working.
        if (raw.kind === 'done') {
          ended = true;
          const decoded = doneEventSchema.safeParse(raw.data);
          if (!decoded.success) {
            this.set({
              error:
                'The turn ended with a frame this build could not read; the stored conversation below is what the backend kept.',
            });
          }
        }
        // Any frame proves the connection works, so the reconnect budget is for
        // connections that die on arrival, not for a long turn's occasional drop.
        this.reconnects = 0;
        const event = toTurnEvent(raw);
        if (event === null) continue;
        pending.push(event);
        flushTimer ??= setTimeout(flush, 0);
      }
    } finally {
      flush();
    }
    if (!this.current(generation)) return;
    if (ended) {
      // The stored message is the record; the live events were the making of
      // it. Refetching is what turns one into the other, and it also picks up
      // whatever the backend attached that the stream did not carry.
      this.cancellation = null;
      if (await this.refresh(generation, null, signal)) this.set({ status: 'idle' });
      return;
    }
    // The stream stopped without a `done`. The turn may still be running on the
    // server, so reconnecting comes first. Past its budget this is `detached`,
    // not `idle` — the difference is whether reattaching would find anything.
    // The connection is released with it: it really is gone, and leaving the
    // flag set would make the Reattach button a no-op, which is the one thing
    // the state calls for.
    if (await this.reconnect(generation)) return;
    const wasAttached = this.attached;
    this.release();
    this.set({ status: wasAttached ? 'detached' : 'idle' });
  }

  /**
   * Read the stored conversation into state. False when it could not be read.
   *
   * The status is the caller's to set. This is called both to finish a turn and
   * in the middle of reattaching to one, and a function that published `idle`
   * on its own would, for the moment between returning and the caller correcting
   * it, describe a running turn as a conversation with nothing happening.
   */
  private async refresh(
    generation: number,
    notice: string | null = null,
    signal?: AbortSignal,
  ): Promise<boolean> {
    // Taken before the request goes out, because what settles a message whose
    // answer was lost is when the question was *asked*, not when it happened to
    // come back.
    const asked = this.now();
    try {
      const conversation = await getConversation(this.ref, { limit: PAGE_SIZE }, signal);
      if (!this.current(generation) || signal?.aborted === true) return false;
      // A page of stored history asked for after that message left *is* the
      // answer to "did it reach the backend": it is either in what came back or
      // it is not, and the backend writes it before it answers the send, so a
      // read that started later cannot miss it. That is what retires the flag,
      // and it is how every route out of it ends — a turn finishing and
      // refetching, a reload that asks again, a Stop that came to nothing.
      //
      // Without the flag it is set by a branch that only runs when a reload has
      // already superseded the send, and cleared by nothing that route reaches:
      // the turn completes, the history refreshes, the session reads `idle`,
      // and the composer stays shut for the rest of the session over a message
      // that is on screen. Without the comparison it is cleared by a read that
      // was already in flight when the message left — one that describes the
      // conversation as it stood *before* it, and settles nothing about it.
      if (asked > this.unresolvedAt) this.unresolvedAt = RESOLVED;
      const page = conversation.message_page;
      this.set({
        title: conversation.title ?? 'New conversation',
        namingState: conversation.naming_state ?? 'manual',
        codexRuntime: conversation.codex_runtime ?? null,
        agentSettings:
          conversation.agent_mode == null || conversation.autonomous == null
            ? null
            : {
                agentMode: conversation.agent_mode,
                autonomous: conversation.autonomous,
                sandbox: conversation.sandbox ?? 'workspace-write',
              },
        messages: conversation.messages,
        startIndex: page?.start_index ?? 0,
        hasEarlier: page?.has_more ?? false,
        interruptedRole: conversation.interrupted_role ?? '',
        live: [],
        error: notice ?? this.state.error,
      });
      return true;
    } catch (error) {
      // Aborting is this browser's own doing and is not a failure to report.
      if (signal?.aborted === true || !this.current(generation)) return false;
      this.fail(error);
      return false;
    }
  }

  /**
   * Ask the server to stop, and wait for it to say it has.
   *
   * The request goes out immediately even when the turn is mid-handoff. Where
   * it is safe to interrupt is the server's question — it knows which role the
   * turn is inside right now, while this browser knows only what a replayed
   * event stream has told it, which can name a role the turn has already left.
   * The backend holds the request until the handoff is complete; the reader
   * sees `cancelling` throughout, which is true the whole time.
   */
  async interrupt(): Promise<void> {
    if (this.state.status !== 'streaming') return;
    // The generation is *not* bumped: the running stream must keep delivering
    // until the server ends it, because the events between asking to stop and
    // stopping are part of the turn's record.
    //
    // Named with the turn on screen, which is the turn the reader is stopping.
    // `null` here is a Stop pressed on a turn this browser cannot name yet —
    // its own message is still in flight, and `cancel` waits for the name — or
    // one from a backend that names none, where an unaddressed Stop is all
    // there has ever been.
    const stop: Cancellation = { turnId: this.turn };
    this.cancellation = stop;
    this.set({ status: 'cancelling' });
    await this.cancel(stop);
  }

  private async cancel(stop: Cancellation): Promise<void> {
    try {
      // A Stop names the turn it is for, and there are two ways to have a name.
      //
      // Usually one is already known: a turn is on screen because a stream was
      // opened for it, and the backend named it on that response head. The Stop
      // goes out at once, naming it, and the server decides whether that turn
      // is still the one running — which is the only place it can be decided.
      //
      // The other way is to wait. The composer offers Stop from the moment a
      // message leaves, so the reader can press it while the POST that would
      // name their turn is still in flight. There is nothing to name yet, and
      // an unnamed Stop is not a weaker version of a named one — it is a
      // different request. It stops *whatever is running*, and the trouble is
      // not that this reader's turn has not started — the backend may well have
      // registered it and begun answering before acknowledging the POST — but
      // that this browser cannot yet say which turn it is. Firing anyway aims
      // the Stop at whichever turn the server happens to be running, which may
      // be another tab's; that one dies, and this browser sits in `cancelling`
      // over a turn of its own with its Stop already spent.
      //
      // So this one case waits for the POST. It is the only Stop that does, and
      // it waits precisely as long as the thing it needs takes to arrive.
      const posting = this.pendingPost;
      if (posting === null) {
        if (await this.ask(stop)) return;
      } else {
        await posting.promise;
        if (!this.outstanding(stop)) return;
        if (!posting.accepted) {
          // That message was never *confirmed* to have become a turn — which is
          // not the same as knowing it did not. A POST that was refused really
          // did not run; a POST whose answer was lost may be running now, and
          // this browser cannot tell the two apart. Either way it has no name
          // to address, and `/cancel` names the conversation, not the turn, so
          // an unnamed request would stop whatever another tab has started
          // since. So no request at all; the send path says what it knows about
          // the message, and says it as an unknown where it is one.
          //
          // But the Stop is *withdrawn* rather than left pending. Held, it
          // would keep the session reading `cancelling` — Stop disabled,
          // nothing outstanding at the server — while a turn this browser
          // cannot rule out runs on. Handing the button back is the honest
          // state: the reader can ask again, and this time there is a turn for
          // the request to land on.
          this.cancellation = null;
          if (this.getState().status === 'cancelling') this.set({ status: 'streaming' });
          return;
        }
        // Named, now that there is a name — and by now that message's turn may
        // already be over with another tab's in its place, which is exactly
        // what the name is for. Recorded on the Stop as well as sent, because
        // this is also the answer to "which turn is this Stop about" for every
        // reconnect after it.
        stop.turnId = posting.turnId;
        if (await this.ask(stop)) return;
      }
      // The server had nothing to stop while this browser still believes a turn
      // is running, so one of the two is out of date and it is not the server's
      // picture that is at fault. Reloading answers it: either the turn has
      // ended and its answer is in the history, or something is running that
      // this connection never saw start.
      this.cancellation = null;
      // Unless the last panel has closed in the meantime. Reloading would open
      // a subscription no view owns and none can release — the Stop was asked
      // for by a reader who is no longer there, and the answer to it is not
      // worth a stream nobody is reading. `attach()` reloads anyway when a
      // reader comes back.
      if (!this.attached) {
        this.set({ error: NOTHING_TO_STOP });
        return;
      }
      await this.reload(NOTHING_TO_STOP);
    } catch (error) {
      // Only while this Stop is still the outstanding one. The turn can end on
      // its own between asking and being refused — the stream delivers `done`,
      // the refetch lands, the session is idle — and putting it back to
      // `streaming` then would resurrect a turn that is over.
      if (!this.outstanding(stop)) return;
      // Refused, so nothing is pending at the server; the reader may ask again.
      this.cancellation = null;
      // Only the state this Stop put the session into is this Stop's to undo.
      // A reload may be in flight, in which case it is `loading` and about to
      // decide the status for itself — and it will now find no Stop pending.
      if (this.getState().status === 'cancelling') this.fail(error, 'streaming');
      else this.set({ error: describeError(error) });
    }
  }

  /**
   * Ask the server to stop, once. True when this Stop has nothing left to do.
   *
   * Which covers both endings: the server stopped the turn — and it is `done`
   * on the stream, not this answer, that ends it, so nothing is set to `idle`
   * here — or something else settled the question while this was in flight.
   */
  private async ask(stop: Cancellation): Promise<boolean> {
    const { cancelled } = await cancelTurn(this.ref, { turnId: stop.turnId });
    return cancelled || !this.outstanding(stop);
  }

  /**
   * Whether the Stop this answer belongs to is still the one being waited on.
   *
   * By reference, which is what makes each Stop its own: a second one on the
   * same turn is a different request, and the first one's answer is no longer
   * anybody's news.
   */
  private outstanding(stop: Cancellation): boolean {
    return this.cancellation === stop;
  }

  /**
   * One page backwards, one at a time.
   *
   * Three guards, each for a different thing that can go wrong, and none of
   * them a spare copy of another.
   *
   * `loadingEarlier` is mutual exclusion: two clicks would otherwise run
   * concurrently under the same generation — paging invalidates nothing, so the
   * generation does not move — ask for the same `before`, and both apply,
   * putting the same page in twice.
   *
   * The generation still has to be checked on the way back, because a *reload*
   * does move it, and a page merged into a conversation that has since been
   * re-read would splice one read's messages into another's.
   *
   * And the boundary is what makes the answer applicable at all: a page answers
   * "what precedes position N", so it may only be applied while N is still the
   * first thing on screen. That is the one a reload can invalidate without
   * failing either of the other two.
   */
  async loadEarlier(): Promise<void> {
    if (!this.state.hasEarlier || this.state.startIndex === 0) return;
    if (this.loadingEarlier) return;
    const generation = this.generation;
    const before = this.state.startIndex;
    this.loadingEarlier = true;
    try {
      const page = await getConversation(this.ref, { limit: PAGE_SIZE, before });
      if (!this.current(generation) || this.state.startIndex !== before) return;
      const start = page.message_page?.start_index ?? 0;
      this.set({
        messages: mergeEarlier(page.messages, this.state.messages, start, before),
        startIndex: start,
        hasEarlier: page.message_page?.has_more ?? false,
      });
    } catch (error) {
      if (!this.current(generation)) return;
      // An older page failing is not a reason to tear down a conversation the
      // user is reading, so the status is left where it was.
      this.set({ error: describeError(error) });
    } finally {
      this.loadingEarlier = false;
    }
  }

  /**
   * Record that something went wrong.
   *
   * `failed` gives up the connection as well as the status. A failure that left
   * `attached` set would leave the session believing it is subscribed to a
   * stream that is gone: `attach()` would return without doing anything, so the
   * Retry the reader is offered would do nothing at all.
   *
   * The `streaming` case is different — the turn is fine, only the cancel
   * request was refused — so the connection stays.
   */
  private fail(error: unknown, status: SessionState['status'] = 'failed'): void {
    if (status === 'failed') this.release();
    this.set({ status, error: describeError(error) });
  }
}

const controllers = new Map<string, SessionController>();

/**
 * The controller for a conversation, created once.
 *
 * A module-level registry rather than a React context. A provider above the
 * router would give the same lifetime, but it would also give every consumer a
 * reason to be inside it: `sessionController` is callable from an event handler
 * that is not rendering anything — the draft flow sends its first message
 * before a panel exists — and that is not expressible as a hook.
 */
export function sessionController(ref: SessionRef): SessionController {
  const key = sessionKey(ref);
  const existing = controllers.get(key);
  if (existing !== undefined) return existing;
  const created = new Controller(ref);
  controllers.set(key, created);
  return created;
}

/** Drop every controller. For tests, which must not share state across cases. */
export function resetSessionControllers(): void {
  for (const controller of controllers.values()) controller.detach();
  controllers.clear();
}
