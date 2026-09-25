/**
 * Keeps what the reader is looking at still while the transcript changes
 * around it.
 *
 * Deferred blocks mount at their real height, which in a long orchestrated turn
 * is often several times the placeholder's estimate. The browser's own scroll
 * anchoring is meant to absorb that, but in this column it regularly picks an
 * anchor it then abandons, and the content leaps by thousands of pixels. So the
 * column turns it off (`overflow-anchor: none`) and anchors itself: remember the
 * element at the top of the viewport and where it sits in the content, and after
 * every layout change, before paint, scroll by however far it moved. Scrolling
 * never moves an element within the content, so programmatic scrolls, including
 * following the newest output, need no special case.
 */
export interface ScrollAnchor {
  /**
   * Takes up any shift since the last look, then re-reads the element at the
   * top of the viewport; call on every scroll. The shift comes first because a
   * commit can land between a scroll and its event: re-reading straight away
   * would adopt the moved layout as the new baseline and never correct it.
   */
  sync(): void;
  dispose(): void;
}

interface Mark {
  readonly node: Element;
  readonly offset: number;
}

export function anchorScrollContent(
  container: HTMLElement,
  options: {
    /** Another mechanism owns the position right now: follow it, do not fight it. */
    suspended: () => boolean;
    /** The reader is following the newest output, so the bottom is what stays put. */
    followsBottom: () => boolean;
  },
): ScrollAnchor {
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') {
    return { sync: () => {}, dispose: () => {} };
  }

  // The deepest element under the probe first, then its ancestors: if a
  // rerender replaces the element itself, the closest survivor still holds.
  let marks: Mark[] = [];
  const offsetOf = (node: Element, viewportTop: number) =>
    node.getBoundingClientRect().top - viewportTop + container.scrollTop;

  // The first element, in reading order, that starts inside the viewport. One
  // that straddles the top edge can grow above the reader without its own top
  // moving, so it would report no shift: a turn whose earlier cards are still
  // mounting, or a deferred placeholder taking its real height. The walk looks
  // inside a straddler, past it when nothing inside starts in view, and past
  // placeholders altogether. Children
  // of the transcript's columns are stacked, so the first candidate at each
  // level is a binary search.
  const firstInView = (parent: Element, viewportTop: number): Element | null => {
    const children = parent.children;
    let low = 0;
    let high = children.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (children[middle].getBoundingClientRect().bottom > viewportTop) high = middle;
      else low = middle + 1;
    }
    for (let index = low; index < children.length; index += 1) {
      const child = children[index];
      // A placeholder is about to take its real height: never the anchor.
      if (child.getAttribute('data-lazy-state') === 'deferred') continue;
      if (child.getBoundingClientRect().top >= viewportTop) return child;
      const inner = firstInView(child, viewportTop);
      if (inner) return inner;
    }
    return null;
  };

  const record = () => {
    const bounds = container.getBoundingClientRect();
    marks = [];
    for (
      let node = firstInView(container, bounds.top);
      node && node !== container;
      node = node.parentElement
    ) {
      marks.push({ node, offset: offsetOf(node, bounds.top) });
    }
  };

  const restore = () => {
    if (options.suspended()) {
      record();
      return;
    }
    const viewportTop = container.getBoundingClientRect().top;
    const mark = marks.find(({ node }) => node.isConnected && container.contains(node));
    const shift = mark ? offsetOf(mark.node, viewportTop) - mark.offset : 0;
    if (Math.abs(shift) > 0.5) {
      // Following the output means the bottom is what the reader watches; a
      // shift above it is taken up by staying at the end.
      if (options.followsBottom()) container.scrollTop = container.scrollHeight;
      else container.scrollTop += shift;
    }
    record();
  };

  // Every layout change in the transcript resizes one of the column's
  // children, and ResizeObserver reports it after layout and before paint.
  const resizes = new ResizeObserver(restore);
  const observeChildren = () => {
    for (const child of Array.from(container.children)) resizes.observe(child);
  };
  const children = new MutationObserver(observeChildren);
  observeChildren();
  children.observe(container, { childList: true });
  record();

  return {
    sync: restore,
    dispose: () => {
      resizes.disconnect();
      children.disconnect();
    },
  };
}
