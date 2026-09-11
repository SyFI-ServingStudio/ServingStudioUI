/**
 * The React binding, and nothing more.
 *
 * `useSyncExternalStore` rather than local state, because the controller is the
 * store: it exists before this hook runs and survives after it unmounts. The
 * hook's whole job is to subscribe, read, and say that someone is watching — no
 * business logic lives here, so the rules about detaching and interrupting
 * cannot be re-decided per component.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { sessionController, type SessionController } from './controller';
import type { SessionRef, SessionState } from './types';

export interface Session {
  readonly state: SessionState;
  readonly controller: SessionController;
}

/**
 * Bind to a conversation.
 *
 * `observe()` is reference-counted, so the connection lives exactly as long as
 * something is showing the conversation, and the *session* outlives all of
 * them. That distinction is the whole design: undocking, opening another
 * result, or switching between the docked and full-page view all unmount this
 * component, and none of them may end a turn.
 */
export function useSession(ref: SessionRef, enabled = true): Session {
  const controller = sessionController(ref);
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
  );
  useEffect(() => (enabled ? controller.observe() : undefined), [controller, enabled]);
  return { state, controller };
}
