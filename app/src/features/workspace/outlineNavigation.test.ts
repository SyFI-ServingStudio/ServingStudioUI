import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeOutlineAnchor, scrollToOutlineAnchor } from './outlineNavigation';

const scrollIntoView = vi.fn();
const originalMatchMedia = window.matchMedia;

function reduceMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches }) as MediaQueryList),
  });
}

function container(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

function anchor(parent: HTMLElement, anchorId: string): HTMLElement {
  const element = document.createElement('div');
  element.dataset.outlineAnchor = anchorId;
  parent.append(element);
  return element;
}

/** One animation frame, as the mount-retry loop schedules them. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

beforeEach(() => {
  scrollIntoView.mockClear();
  reduceMotion(false);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe('scrollToOutlineAnchor', () => {
  it('centres a mounted anchor in one smooth move and marks the landing', () => {
    const column = container();
    const target = anchor(column, 't1-c0-n1');

    scrollToOutlineAnchor(column, { anchorId: 't1-c0-n1', blockId: 't1-c0' });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(target).toHaveAttribute('data-outline-flash', 'animated');
  });

  it('degrades to an instant move and a static mark under reduced motion', () => {
    reduceMotion(true);
    const column = container();
    const target = anchor(column, 't1-c0-n1');

    scrollToOutlineAnchor(column, { anchorId: 't1-c0-n1', blockId: 't1-c0' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(target).toHaveAttribute('data-outline-flash', 'static');
  });

  it('jumps to the deferred block first, then settles once the card mounts', async () => {
    const column = container();
    const block = document.createElement('div');
    block.dataset.outlineBlock = 't1-c0';
    column.append(block);

    scrollToOutlineAnchor(column, { anchorId: 't1-c0-n1', blockId: 't1-c0' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'auto' });

    const target = anchor(block, 't1-c0-n1');
    await nextFrame();
    await nextFrame();

    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'smooth' });
    expect(target).toHaveAttribute('data-outline-flash', 'animated');
  });

  it('stops waiting for a mount once the caller cancels', async () => {
    const column = container();
    const block = document.createElement('div');
    block.dataset.outlineBlock = 't1-c0';
    column.append(block);

    const cancel = scrollToOutlineAnchor(column, { anchorId: 't1-c0-n1', blockId: 't1-c0' });
    cancel();
    anchor(block, 't1-c0-n1');
    await nextFrame();
    await nextFrame();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

/** A column of the given geometry, scrolled to `scrollTop`. */
function scrollableColumn(scrollTop: number, scrollHeight: number): HTMLElement {
  const column = container();
  vi.spyOn(column, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(column, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  column.scrollTop = scrollTop;
  column.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  return column;
}

function anchorAt(column: HTMLElement, anchorId: string, top: number): void {
  const node = anchor(column, anchorId);
  node.getBoundingClientRect = () => ({ top }) as DOMRect;
}

describe('activeOutlineAnchor', () => {
  it('reports the last anchor whose top has passed the column middle', () => {
    const column = scrollableColumn(300, 2000);
    [-50, 100, 199, 260].forEach((top, index) => anchorAt(column, `t1-c${index}`, top));

    expect(activeOutlineAnchor(column)).toBe('t1-c2');
  });

  it('reports nothing while every anchor is still below the middle', () => {
    const column = scrollableColumn(0, 2000);
    anchorAt(column, 't1-c0', 320);

    expect(activeOutlineAnchor(column)).toBeNull();
  });

  it('marks the newest entry once the column is scrolled to its end', () => {
    // Without the end case the last screenful could never mark itself: both of
    // these anchors sit below the midpoint of a column that cannot scroll on.
    const column = scrollableColumn(1600, 2000);
    anchorAt(column, 't1-c0', 250);
    anchorAt(column, 't1-c1', 340);

    expect(activeOutlineAnchor(column)).toBe('t1-c1');
  });
});
