import type { OutlineEntry } from './agentOutline';

/**
 * Navigation from the progress rail into the transcript.
 *
 * The transcript unmounts distant content (`LazyTranscriptBlock`), so the card
 * a rail entry points at usually does not exist yet when the entry is clicked.
 * Every entry therefore carries two handles: the exact anchor, and the lazy
 * block that owns it. The block placeholder is always in the DOM and preserves
 * approximate scroll geometry, so jumping to it brings the real card within the
 * block's `IntersectionObserver` margin and it mounts a frame or two later.
 */

const FLASH_ATTRIBUTE = 'data-outline-flash';
const FLASH_MS = 900;
/** Two-ish seconds of frames is far more than a lazy block needs to mount. */
const MAX_MOUNT_FRAMES = 72;

// Ids come from `conversationOutline` and are always `[a-z0-9-]`, so they need
// no selector escaping.
function findAnchor(container: HTMLElement, anchorId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-outline-anchor="${anchorId}"]`);
}

function findBlock(container: HTMLElement, blockId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-outline-block="${blockId}"]`);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Marks where the eye should land. The attribute drives a CSS fade defined
 * alongside the transcript; under reduced motion it is a static outline that
 * simply clears itself.
 */
function flash(node: HTMLElement): () => void {
  node.setAttribute(FLASH_ATTRIBUTE, prefersReducedMotion() ? 'static' : 'animated');
  const timer = window.setTimeout(() => node.removeAttribute(FLASH_ATTRIBUTE), FLASH_MS);
  return () => {
    window.clearTimeout(timer);
    node.removeAttribute(FLASH_ATTRIBUTE);
  };
}

/**
 * Centres `entry` in `container`, mounting it first if the transcript has it
 * deferred. Returns a cancel function so a second click supersedes the first.
 */
export function scrollToOutlineAnchor(
  container: HTMLElement,
  entry: Pick<OutlineEntry, 'anchorId' | 'blockId' | 'fallbackBlockId'>,
): () => void {
  const smooth = prefersReducedMotion() ? 'auto' : 'smooth';
  let clearFlash: (() => void) | null = null;
  let frame = 0;
  let cancelled = false;

  const settle = (node: HTMLElement) => {
    // jsdom and some embedded engines have no scrollIntoView; the optional call
    // keeps the rail usable (and testable) without it.
    node.scrollIntoView?.({ block: 'center', behavior: smooth });
    clearFlash = flash(node);
  };

  const anchor = findAnchor(container, entry.anchorId);
  if (anchor) {
    settle(anchor);
    return () => {
      cancelled = true;
      clearFlash?.();
    };
  }

  // Coarse jump first, so the deferred block enters its observer margin. It is
  // instant on purpose: animating to an estimated position and then again to
  // the settled one reads as a stutter.
  let mountedWaypoint =
    findBlock(container, entry.blockId) ??
    (entry.fallbackBlockId ? findBlock(container, entry.fallbackBlockId) : null);
  mountedWaypoint?.scrollIntoView?.({ block: 'center', behavior: 'auto' });

  let attempts = 0;
  const waitForMount = () => {
    if (cancelled) return;
    const mounted = findAnchor(container, entry.anchorId);
    if (mounted) {
      settle(mounted);
      return;
    }
    // A persisted message mounts in two layers: first its always-present turn
    // placeholder, then the card placeholder inside it. Move to each newly
    // available waypoint once so the exact milestone can enter the observer
    // margin without an unstable smooth-scroll chain.
    const nextWaypoint = findBlock(container, entry.blockId);
    if (nextWaypoint && nextWaypoint !== mountedWaypoint) {
      mountedWaypoint = nextWaypoint;
      nextWaypoint.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    }
    if ((attempts += 1) > MAX_MOUNT_FRAMES) return;
    frame = window.requestAnimationFrame(waitForMount);
  };
  frame = window.requestAnimationFrame(waitForMount);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    clearFlash?.();
  };
}

/**
 * Whether an anchor is on screen. A jump the container could not fully centre,
 * because it clamped at the top or bottom, still counts: the reader is looking
 * at the entry they picked, so the rail keeps it marked.
 */
export function outlineAnchorOnScreen(container: HTMLElement, anchorId: string): boolean {
  const node = findAnchor(container, anchorId);
  if (!node) return false;
  const viewport = container.getBoundingClientRect();
  const bounds = node.getBoundingClientRect();
  return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
}

/**
 * The entry the reader is currently looking at: the last anchor whose top has
 * passed the container's vertical middle. Reads only mounted anchors, which is
 * exactly the set that can be on screen.
 *
 * At the very end of the column that rule would strand every entry sitting
 * below the midpoint, so the last screenful could never mark its own newest
 * entry. Once scrolled to the end, the last anchor wins.
 */
export function activeOutlineAnchor(container: HTMLElement): string | null {
  const anchors = container.querySelectorAll<HTMLElement>('[data-outline-anchor]');
  if (anchors.length === 0) return null;
  if (container.scrollHeight - container.scrollTop - container.clientHeight <= 4) {
    return anchors[anchors.length - 1].dataset.outlineAnchor ?? null;
  }
  const middle = container.getBoundingClientRect().top + container.clientHeight / 2;
  let active: string | null = null;
  for (const node of anchors) {
    if (node.getBoundingClientRect().top > middle) break;
    active = node.dataset.outlineAnchor ?? active;
  }
  return active;
}
