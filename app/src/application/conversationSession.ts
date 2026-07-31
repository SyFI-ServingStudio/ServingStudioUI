const CONVERSATION_ID_KEY_PREFIX = 'vibesim.conversation.id';

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
