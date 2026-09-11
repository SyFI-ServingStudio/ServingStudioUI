/**
 * Location changes initiated by the persistent Agent surface.
 *
 * The surface can live beside a result or fill the workspace, but the
 * conversation itself has one address in either case. These transforms keep
 * that surrounding choice while replacing only the ChatRef. They are pure so
 * an async draft completion can be applied to the Location that is current
 * when the backend answers, rather than to the one captured when Send began.
 */
import type { ChatRef, ConversationId, Location, WorkspaceId } from '../location';

export function chatAt(location: Location): ChatRef | null {
  if (location.view === 'result') return location.chat;
  if (location.view === 'chat') return location.chat;
  return null;
}

/** Put a conversation in the same full/docked place as the current Agent. */
export function showConversation(
  location: Location,
  chat: ChatRef,
): Extract<Location, { view: 'result' | 'chat' }> {
  if (location.view === 'result' && location.ref.workspace === chat.workspace) {
    return { ...location, chat };
  }
  return { view: 'chat', chat };
}

/** Open a clean composer without carrying a previous conversation id. */
export function startNewConversation(
  location: Location,
  workspace: WorkspaceId,
): Extract<Location, { view: 'result' | 'chat' }> {
  return showConversation(location, { state: 'draft', workspace });
}

/**
 * Claim the id returned for a draft, if that draft is still on screen.
 *
 * A late create response must not reopen Agent after it was closed or replace
 * a conversation the reader selected while the request was outstanding.
 */
export function finishDraft(
  location: Location,
  workspace: WorkspaceId,
  id: ConversationId,
): Location | null {
  const current = chatAt(location);
  if (current?.state !== 'draft' || current.workspace !== workspace) return null;
  return showConversation(location, { state: 'created', workspace, id });
}

/** Close a dock, or return a full Agent page to its workspace catalog. */
export function closeConversation(location: Location): Location {
  if (location.view === 'result') return { ...location, chat: null };
  const current = chatAt(location);
  if (current === null) return location;
  return {
    view: 'catalog',
    filter: { workspace: current.workspace, kinds: [], query: null },
  };
}
