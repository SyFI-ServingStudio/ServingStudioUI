const HISTORY_PINNED_KEY = 'vibesim.conversation.history.pinned';

export function savedHistoryPinned(): boolean {
  try {
    return window.localStorage.getItem(HISTORY_PINNED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveHistoryPinned(pinned: boolean): void {
  try {
    if (pinned) {
      window.localStorage.setItem(HISTORY_PINNED_KEY, 'true');
    } else {
      window.localStorage.removeItem(HISTORY_PINNED_KEY);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted embeds; the current UI state still works.
  }
}
