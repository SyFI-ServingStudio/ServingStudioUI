/**
 * The browser boundary. This is the only file in the application that reads
 * `window.location` or calls `history`, which is what keeps every other module
 * testable with plain values.
 *
 * `push` and `replace` are one parameter, not two APIs, because they are the
 * same operation with different history semantics: a drill-down pushes, a
 * normalization (revision pinned, draft chat given an id) replaces.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { formatLocation } from './format';
import { parseLocation } from './parse';
import { locationSchema, workspaceIdSchema, type Location, type WorkspaceId } from './types';

export type NavigateIntent = 'push' | 'replace';
export type Navigate = (location: Location, intent: NavigateIntent) => void;

/**
 * The workspace a link without `w=` belongs to.
 *
 * `?workspace=` in the *document* query (outside the hash) is a deployment pin —
 * how a server hands a browser one workspace — and stays supported for that
 * reason. It is not part of the `Location` grammar.
 */
const DEPLOYMENT_WORKSPACE_PARAM = 'workspace';
const FALLBACK_WORKSPACE = 'w_main';

export function defaultWorkspace(): WorkspaceId {
  const pinned = new URLSearchParams(window.location.search).get(DEPLOYMENT_WORKSPACE_PARAM);
  const checked = workspaceIdSchema.safeParse(pinned);
  return checked.success ? checked.data : FALLBACK_WORKSPACE;
}

/**
 * `pushState` and `replaceState` do not fire `hashchange`, so this module keeps
 * its own subscriber set and notifies it after every navigation. The DOM events
 * still matter for the back button and for a hash typed into the address bar.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}

/** A string, so `useSyncExternalStore` compares snapshots by value. Parsing
 * happens in a `useMemo` below; returning a fresh object here would re-render
 * forever. */
function currentHash(): string {
  return window.location.hash;
}

/**
 * `null` when the hash addresses nothing this build can represent.
 *
 * No server snapshot is passed to `useSyncExternalStore`: a hash-routed
 * application has no address until a browser gives it one, and `defaultWorkspace`
 * reads `window` too. Supplying a fake server snapshot would only let a render
 * without a DOM fail later and less clearly than React's own message.
 */
export function useLocation(): Location | null {
  const hash = useSyncExternalStore(subscribe, currentHash);
  const workspace = defaultWorkspace();
  return useMemo(() => parseLocation(hash, { workspace }), [hash, workspace]);
}

export const navigate: Navigate = (location, intent) => {
  if (import.meta.env.DEV) {
    const checked = locationSchema.safeParse(location);
    if (!checked.success) {
      // A Location that fails its own schema would serialize to a URL that
      // cannot be parsed back. Surface it where it is built, not on reload.
      console.error('navigate: Location violates its schema', checked.error.issues);
    }
  }
  const href = formatLocation(location);
  // Re-committing the current address would add a history entry that the back
  // button then has to consume with no visible effect.
  if (href === window.location.hash) return;
  if (intent === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
  for (const listener of listeners) listener();
};
