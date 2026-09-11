import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scrollToOutlineAnchor } from './outlineNavigation';

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
  it('mounts an outer persisted turn before its nested card and milestone', async () => {
    const column = container();
    const turnBlock = document.createElement('div');
    turnBlock.dataset.outlineBlock = 't1';
    column.append(turnBlock);

    scrollToOutlineAnchor(column, {
      anchorId: 't1-c0-n1',
      blockId: 't1-c0',
      fallbackBlockId: 't1',
    });
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'auto' });

    const cardBlock = document.createElement('div');
    cardBlock.dataset.outlineBlock = 't1-c0';
    turnBlock.append(cardBlock);
    await nextFrame();
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'auto' });

    const target = anchor(cardBlock, 't1-c0-n1');
    await nextFrame();
    await nextFrame();
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
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
