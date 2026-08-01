import type { CodexRuntimeSelection } from './conversationRepository';

const CONVERSATION_ID_KEY_PREFIX = 'vibesim.conversation.id';
const CODEX_RUNTIME_KEY = 'vibesim.entry.codex-runtime';

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

function roleRuntimeFrom(value: unknown): { model: string; effort: string; serviceTier: 'default' | 'fast' } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { model, effort, serviceTier } = value as {
    model?: unknown;
    effort?: unknown;
    serviceTier?: unknown;
  };
  return typeof model === 'string' && model && typeof effort === 'string' && effort
    ? { model, effort, serviceTier: serviceTier === 'fast' ? 'fast' : 'default' }
    : null;
}

/** Carries the Page 0 role selection into the lazily-created Agent conversation. */
export function pendingCodexRuntime(): CodexRuntimeSelection | null {
  try {
    const rawSelection = window.sessionStorage.getItem(CODEX_RUNTIME_KEY);
    if (!rawSelection) return null;
    const selection = JSON.parse(rawSelection) as Record<string, unknown>;
    const orchestrator = roleRuntimeFrom(selection.orchestrator);
    const implementer = roleRuntimeFrom(selection.implementer);
    // The server re-validates against its live catalog, so this only has to
    // reject shapes the picker cannot render.
    return orchestrator && implementer ? { orchestrator, implementer } : null;
  } catch {
    return null;
  }
}

export function rememberPendingCodexRuntime(selection: CodexRuntimeSelection): void {
  try {
    window.sessionStorage.setItem(CODEX_RUNTIME_KEY, JSON.stringify(selection));
  } catch {
    // The Agent surface still falls back to the backend catalog defaults.
  }
}

export function forgetPendingCodexRuntime(): void {
  try {
    window.sessionStorage.removeItem(CODEX_RUNTIME_KEY);
  } catch {
    // There is no persisted selection to clear in restricted embeds.
  }
}
