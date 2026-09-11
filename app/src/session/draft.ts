/**
 * Turning a draft into a conversation.
 *
 * One function, in the session layer rather than in the composer that calls it,
 * because the order it performs is a rule about sessions and not about the view
 * that happens to be showing: create, hand the first message to the controller,
 * *then* let the caller change the address. Sending before the address changes
 * means the turn is already running when the panel mounts, so the panel attaches
 * to a live session instead of reloading an empty history over it — and because
 * `sessionController` is a registry keyed by the ref, the controller this
 * creates is the one the panel will find.
 *
 * Anything that opens a composer needs that ordering. Leaving it in the
 * composer meant every second entry point had to rediscover it.
 */
// From `location/types` rather than the barrel: the barrel also exports the
// navigation hook, and the session layer is not allowed to depend on React.
// A type-only import costs nothing at runtime — this is about the rule, so that
// the next import from here is written the same way and is a value.
import type { WorkspaceId } from '../location/types';
import { createConversation } from './api';
import { sessionController, type Unsubscribe } from './controller';
import {
  parseSessionRef,
  type AgentSettings,
  type CodexRuntimeSelection,
  type SessionRef,
} from './types';

export interface StartConversationOptions {
  /** Initial conversation settings; sandbox can change on subsequent turns. */
  readonly create?: {
    readonly codexRuntime: CodexRuntimeSelection;
    readonly agentSettings: AgentSettings;
  };
  /** Per-turn context such as the frozen Analyzer citation dictionary. */
  readonly turn?: Readonly<Record<string, unknown>>;
}

/** A conversation that has just been created, and who is holding it open. */
export interface StartedConversation {
  readonly session: SessionRef;
  /**
   * Let go of the subscription this opened.
   *
   * The caller owns it until a view takes over, and must call this either way.
   * Sending attaches — that is what stops the first panel reloading history
   * over a turn already running — so until something releases it the connection
   * stays open with nobody watching. A draft the reader navigates away from
   * before the backend answers is exactly that case.
   */
  readonly release: Unsubscribe;
}

/**
 * Create a conversation and start its first turn.
 *
 * Resolves as soon as the turn has been started, not when it ends: a turn runs
 * for minutes and the caller's job — reporting the new id — is done long before
 * that. The turn's progress is the controller's to report.
 */
export async function startConversation(
  workspace: WorkspaceId,
  text: string,
  options: StartConversationOptions = {},
): Promise<StartedConversation> {
  const settings = options.create;
  const created = await createConversation(
    workspace,
    settings === undefined
      ? {}
      : {
          sandbox: settings.agentSettings.sandbox,
          autonomous: settings.agentSettings.autonomous,
          agent_mode: settings.agentSettings.agentMode,
          codex_runtime: settings.codexRuntime,
        },
  );
  const ref = parseSessionRef(workspace, created.id);
  if (ref === null) {
    // The backend issued something this build cannot put in an address. Worth
    // saying plainly: the conversation exists on the server, and the reason it
    // cannot be opened is here rather than there.
    throw new Error(
      `the backend issued a conversation id this build cannot address: ${created.id}`,
    );
  }
  const controller = sessionController(ref);
  // Not awaited: this resolves only when the turn ends. The controller holds
  // the state either way, and a rejection there becomes the session's error.
  void controller.send(text, {
    ...options.turn,
    ...(settings === undefined
      ? {}
      : {
          agent_mode: settings.agentSettings.agentMode,
          autonomous_mode: settings.agentSettings.autonomous,
          sandbox_mode: settings.agentSettings.sandbox,
        }),
  });
  // After sending, so this counts a watcher rather than starting a load: `send`
  // has already attached, and `observe` on an attached controller only takes
  // the reference.
  return { session: ref, release: controller.observe() };
}
