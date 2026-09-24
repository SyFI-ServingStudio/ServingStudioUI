const HISTORY_PINNED_KEY = 'vibesim.conversation.history.pinned';

export function savedHistoryPinned(): boolean {
  try {
    // Pinned unless the reader has unpinned it: on the full page the rail is how
    // one moves between conversations and workspaces.
    return window.localStorage.getItem(HISTORY_PINNED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveHistoryPinned(pinned: boolean): void {
  try {
    window.localStorage.setItem(HISTORY_PINNED_KEY, pinned ? 'true' : 'false');
  } catch {
    // Storage can be unavailable in privacy-restricted embeds; the current UI state still works.
  }
}
