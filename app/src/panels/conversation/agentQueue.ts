/** A message typed while a turn was running, waiting for its own turn. */
export interface QueuedMessage<TContext = unknown> {
  readonly id: string;
  readonly text: string;
  readonly context: TContext | null;
  /** Set by an interrupt: the queue stops draining until the user acts. */
  readonly suspended: boolean;
}

/** Above this the strip crowds out the live timeline it is queued behind. */
export const MAX_QUEUED_MESSAGES = 5;

let queuedMessageSequence = 0;

/** Unique within this page load; queued-message ids never leave the browser. */
export function nextQueuedMessageId(): string {
  queuedMessageSequence += 1;
  return `queued-${queuedMessageSequence}`;
}
