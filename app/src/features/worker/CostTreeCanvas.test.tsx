import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { annotate, leaf } from '../../domain/cost-tree';
import CostTreeCanvas, { COST_TREE_VIEWPORT_HEIGHT } from './CostTreeCanvas';

const controls = {
  zoomIn: 'Zoom in test tree',
  zoomOut: 'Zoom out test tree',
  fit: 'Fit test tree',
  reset: 'Reset test tree',
};
const firstTree = annotate(leaf('first.kernel', 'single_gemm', '{}', 1));
const secondTree = annotate(leaf('second.kernel', 'single_gemm', '{}', 2));

function rect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'button', { value: 0 });
  return event;
}

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

describe('CostTreeCanvas', () => {
  it('owns native viewport controls and resets the view for a new exact-operation tree', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('aria-label') === 'Test CostTree canvas') return rect(800, 675);
      if (this.dataset.testid === 'cost-tree-content') {
        const scale = Number(this.dataset.zoom ?? 0.9);
        return rect(200 * scale, 100 * scale);
      }
      return rect(120, 40);
    });
    const user = userEvent.setup();
    const props = {
      selectedLeafId: null,
      selectedParallelId: null,
      onSelectLeaf: vi.fn(),
      onSelectParallel: vi.fn(),
      onSelectRoot: vi.fn(),
      ariaLabel: 'Test CostTree canvas',
      controlLabels: controls,
    };
    const view = render(<CostTreeCanvas {...props} tree={firstTree} />);
    const viewport = screen.getByRole('region', { name: 'Test CostTree canvas' });
    const content = screen.getByTestId('cost-tree-content');

    expect(viewport).toHaveStyle({ height: `${COST_TREE_VIEWPORT_HEIGHT}px` });
    expect(content.style.transform).toBe('translate(310px, 292.5px) scale(0.9)');
    await user.click(screen.getByRole('button', { name: controls.zoomIn }));
    expect(content.dataset.zoom).toBe('1.08');

    fireEvent(content, pointerEvent('pointerdown', 4, 40, 40));
    fireEvent(viewport, pointerEvent('pointermove', 4, 90, 70));
    fireEvent(viewport, pointerEvent('pointerup', 4, 90, 70));
    expect(content.style.transform).not.toBe('translate(310px, 292.5px) scale(0.9)');

    view.rerender(<CostTreeCanvas {...props} tree={secondTree} />);
    expect(content.style.transform).toBe('translate(310px, 292.5px) scale(0.9)');
    expect(screen.getByRole('button', { name: 'Inspect kernel second.kernel' })).toBeVisible();
  });
});
