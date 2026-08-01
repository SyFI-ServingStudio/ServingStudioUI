import type { CodexBackendSelection } from './conversationRepository';

const CONVERSATION_ID_KEY_PREFIX = 'vibesim.conversation.id';
const CODEX_BACKENDS_KEY = 'vibesim.entry.codex-backends';

function conversationIdKey(workspaceId: string): string {
  return `${CONVERSATION_ID_KEY_PREFIX}.${workspaceId}`;
}

/** The active conversation is a workspace-local browser preference, not Analyzer state. */
export function activeConversationId(workspaceId: string): string | null {
  try {
    return window.sessionStorage.getItem(conversationIdKey(workspaceId));
  } catch {
    return null;
  }
}

export function rememberActiveConversation(workspaceId: string, conversationId: string): void {
  try {
    window.sessionStorage.setItem(conversationIdKey(workspaceId), conversationId);
  } catch {
    // A privacy-restricted browser can still use the conversation for this mount.
  }
}

export function forgetActiveConversation(workspaceId: string): void {
  try {
    window.sessionStorage.removeItem(conversationIdKey(workspaceId));
  } catch {
    // A privacy-restricted browser has no persistent preference to clear.
  }
}

/** Carries the Page 0 role selection into the lazily-created Agent conversation. */
export function pendingCodexBackends(): CodexBackendSelection | null {
  try {
    const rawSelection = window.sessionStorage.getItem(CODEX_BACKENDS_KEY);
    if (!rawSelection) return null;
    const selection = JSON.parse(rawSelection) as Partial<CodexBackendSelection>;
    const validBackend = (value: unknown) => value === 'traditional' || value === 'codexds';
    return validBackend(selection.orchestrator) && validBackend(selection.implementer)
      ? (selection as CodexBackendSelection)
      : null;
  } catch {
    return null;
  }
}

export function rememberPendingCodexBackends(selection: CodexBackendSelection): void {
  try {
    window.sessionStorage.setItem(CODEX_BACKENDS_KEY, JSON.stringify(selection));
  } catch {
    // The Agent surface still falls back to the backend catalog defaults.
  }
}

export function forgetPendingCodexBackends(): void {
  try {
    window.sessionStorage.removeItem(CODEX_BACKENDS_KEY);
  } catch {
    // There is no persisted selection to clear in restricted embeds.
  }
}
