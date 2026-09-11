import { isConversationRole, type ConversationRole } from '../panels/conversation/agentTimeline';
import type {
  CodexModelOption,
  CodexRoleRuntime,
  CodexRuntimeSelection,
} from '../panels/conversation/agentTypes';
import type { StoredMessage, TurnEvent } from '../session/types';

export function resolvedRuntime(
  current: CodexRuntimeSelection,
  defaults: CodexRuntimeSelection,
  models: readonly CodexModelOption[],
): CodexRuntimeSelection {
  const resolve = (runtime: CodexRoleRuntime, fallback: CodexRoleRuntime): CodexRoleRuntime => {
    const model = models.find((option) => option.id === runtime.model && option.available);
    if (model === undefined) return fallback;
    return {
      ...runtime,
      serviceTier: model.serviceTiers.includes(runtime.serviceTier)
        ? runtime.serviceTier
        : model.defaultServiceTier,
    };
  };
  return {
    orchestrator: resolve(current.orchestrator, defaults.orchestrator),
    implementer: resolve(current.implementer, defaults.implementer),
    assistant: resolve(current.assistant, defaults.assistant),
  };
}

export function roleState(events: readonly TurnEvent[]): {
  activeRole: ConversationRole | null;
  pendingRole: string;
} {
  let activeRole: ConversationRole | null = null;
  let pendingRole = '';
  for (const event of events) {
    if (event.role != null && isConversationRole(event.role)) activeRole = event.role;
    if (event.kind === 'role_start') pendingRole = event.role ?? '';
    if (event.kind === 'role_ready' && (event.role == null || event.role === pendingRole)) {
      pendingRole = '';
    }
  }
  return { activeRole, pendingRole };
}

export function terminalResult(
  events: readonly TurnEvent[],
): 'completed' | 'stopped' | 'failed' | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind !== 'done') continue;
    if (event.outcome === 'cancelled') return 'stopped';
    const failure = (event as Record<string, unknown>).failure;
    return failure == null ? 'completed' : 'failed';
  }
  return null;
}

/** Identity of the newest stored row, including legacy rows without server ids. */
export function lastMessageMarker(messages: readonly StoredMessage[]): string | null {
  const message = messages.at(-1);
  if (message === undefined) return null;
  return message.id === undefined
    ? `${messages.length}:${message.role}:${message.content}`
    : `#${message.id}`;
}

/**
 * Classify the newly stored row when React never painted the transient done
 * frame before the controller's refresh replaced it.
 */
export function storedTerminalResult(
  messages: readonly StoredMessage[],
  before: string | null,
): 'completed' | 'stopped' | 'failed' | null {
  const message = messages.at(-1);
  if (
    message === undefined ||
    message.role !== 'assistant' ||
    lastMessageMarker(messages) === before
  ) {
    return null;
  }
  const failure = (message as Record<string, unknown>).failure;
  if (failure != null) return 'failed';
  const final = [...(message.activity ?? [])].reverse().find((event) => event.kind === 'final');
  return final?.outcome === 'cancelled' ? 'stopped' : 'completed';
}

export function sameRuntime(left: CodexRuntimeSelection, right: CodexRuntimeSelection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Accept a refresh only while the picker still contains the prior server value. */
export function reconciledRuntime(
  current: CodexRuntimeSelection,
  previousServer: CodexRuntimeSelection | null,
  incomingServer: CodexRuntimeSelection,
): CodexRuntimeSelection {
  return previousServer === null || sameRuntime(current, previousServer) ? incomingServer : current;
}

export function shouldSpendArmedInterrupt(
  armed: boolean,
  status: string,
  pendingRole: string,
  readyCount: number,
  armedAtReadyCount: number,
): boolean {
  return armed && status === 'streaming' && pendingRole === '' && readyCount > armedAtReadyCount;
}
