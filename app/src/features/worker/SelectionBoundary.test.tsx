import { act, render } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import SelectionBoundary from './SelectionBoundary';

const animateMock = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));

vi.mock('motion/react', () => ({ animate: animateMock }));

let resizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect() {}
  observe() {}
  unobserve() {}
}

function resizeEntry(target: Element, contentRect: DOMRectReadOnly): ResizeObserverEntry {
  return {
    target,
    contentRect,
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  };
}

beforeEach(() => {
  animateMock.mockClear();
  resizeCallback = null;
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

// A stubbed ResizeObserver outlives this file otherwise, and any later file in
// the same worker sees a global that jsdom does not normally provide.
afterAll(() => vi.unstubAllGlobals());

describe('SelectionBoundary geometry', () => {
  it('uses logical SVG layout dimensions instead of a scaled bounding rect', () => {
    const { container } = render(
      <div style={{ position: 'relative', width: 104, height: 36, borderTopLeftRadius: 8 }}>
        <SelectionBoundary color="#007f78" />
      </div>,
    );
    const svg = container.querySelector('svg');
    if (svg === null || resizeCallback === null)
      throw new Error('Boundary observer was not ready.');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      width: 78,
      height: 27,
      x: 0,
      y: 0,
      top: 0,
      right: 78,
      bottom: 27,
      left: 0,
      toJSON: () => ({}),
    });

    const logicalRect = { width: 104, height: 36 } as DOMRectReadOnly;
    act(() => {
      resizeCallback?.([resizeEntry(svg, logicalRect)], {} as ResizeObserver);
    });

    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(3);
    expect(paths[0]).toHaveAttribute('d', 'M 8 1 Q 1 1 1 8 L 1 28 Q 1 35 8 35');
    expect(paths[1]).toHaveAttribute('d', 'M 8 1 L 96 1 Q 103 1 103 8 L 103 18');
    expect(paths[2]).toHaveAttribute('d', 'M 8 35 L 96 35 Q 103 35 103 28 L 103 18');
    expect(svg.getBoundingClientRect).not.toHaveBeenCalled();
    expect(animateMock).toHaveBeenCalledTimes(1);
    expect(animateMock).toHaveBeenCalledWith(
      0,
      1,
      expect.objectContaining({ duration: 0.45, ease: [0.4, 0, 0.2, 1] }),
    );

    svg.parentElement?.style.setProperty('transform', 'scale(0.75)');
    act(() => {
      resizeCallback?.([resizeEntry(svg, logicalRect)], {} as ResizeObserver);
    });
    expect(paths[1]).toHaveAttribute('d', 'M 8 1 L 96 1 Q 103 1 103 8 L 103 18');
    expect(animateMock).toHaveBeenCalledTimes(1);
  });
});
