import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import CostTreeCanvasDemo from './CostTreeCanvasDemo';
import { COST_TREE_CANVAS_DEMO_TREE } from './fixture';

let nextAnimationFrameId = 1;
const animationFrameCallbacks = new Map<number, FrameRequestCallback>();

function flushNextAnimationFrame(): void {
  const next = animationFrameCallbacks.entries().next().value as
    [number, FrameRequestCallback] | undefined;
  if (next === undefined) throw new Error('Expected a pending animation frame.');
  const [frameId, callback] = next;
  animationFrameCallbacks.delete(frameId);
  callback(performance.now());
}

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

beforeEach(() => {
  nextAnimationFrameId = 1;
  animationFrameCallbacks.clear();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const frameId = nextAnimationFrameId++;
    animationFrameCallbacks.set(frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
    animationFrameCallbacks.delete(frameId);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute('aria-label') === 'CostTree canvas demo') return rect(800, 675);
    if (this.dataset.testid === 'cost-tree-content') {
      const scale = Number(this.dataset.zoom ?? 0.9);
      return rect(1600 * scale, 800 * scale);
    }
    return rect(120, 40);
  });
});

describe('isolated CostTree canvas demo', () => {
  it('uses the exact real-operation header and exposes named native controls', () => {
    render(<CostTreeCanvasDemo />);

    expect(screen.getByText(/1 · qwen3_ffn_moe · 8 GPU/)).toBeVisible();
    expect(screen.getByText(/iter 9418 · batch 0 · operation 8/)).toBeVisible();
    expect(screen.getAllByText('426.1 µs')[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zoom in CostTree demo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zoom out CostTree demo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fit CostTree demo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset CostTree demo' })).toBeVisible();
    expect(COST_TREE_CANVAS_DEMO_TREE.totalMs).toBeCloseTo(0.426126494, 8);
  });

  it('fits, zooms around the viewport, and resets without React pointer state', async () => {
    const user = userEvent.setup();
    render(<CostTreeCanvasDemo />);
    const viewport = screen.getByRole('region', { name: 'CostTree canvas demo' });
    const content = screen.getByTestId('cost-tree-content');

    const initialTransform = content.style.transform;
    expect(Number(content.dataset.zoom)).toBeCloseTo(0.9, 4);
    await user.click(screen.getByRole('button', { name: 'Zoom in CostTree demo' }));
    expect(Number(content.dataset.zoom)).toBeCloseTo(1.08, 4);

    const wheel = new WheelEvent('wheel', {
      deltaY: 100,
      clientX: 200,
      clientY: 120,
      bubbles: true,
      cancelable: true,
    });
    expect(viewport.dispatchEvent(wheel)).toBe(false);
    expect(wheel.defaultPrevented).toBe(true);
    expect(content.dataset.zoom).toBe('1.08');
    flushNextAnimationFrame();
    expect(Number(content.dataset.zoom)).toBeLessThan(1.08);
    expect(content.dataset.zoom).toMatch(/^\d+(?:\.\d{1,3})?$/);

    await user.click(screen.getByRole('button', { name: 'Reset CostTree demo' }));
    expect(content.dataset.zoom).toBe('0.9');
    expect(content.style.transform).toBe(initialTransform);

    await user.click(screen.getByRole('button', { name: 'Fit CostTree demo' }));
    expect(Number(content.dataset.zoom)).toBeCloseTo(0.4775, 4);
  });

  it('coalesces wheel bursts into one frame and cancels pending work on cleanup', () => {
    const { unmount } = render(<CostTreeCanvasDemo />);
    const viewport = screen.getByRole('region', { name: 'CostTree canvas demo' });
    const content = screen.getByTestId('cost-tree-content');

    fireEvent.wheel(viewport, { deltaY: 20, clientX: 160, clientY: 90 });
    fireEvent.wheel(viewport, { deltaY: 30, clientX: 170, clientY: 100 });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(content.dataset.zoom).toBe('0.9');

    flushNextAnimationFrame();
    expect(Number(content.dataset.zoom)).toBeLessThan(0.9);

    fireEvent.wheel(viewport, { deltaY: -20, clientX: 170, clientY: 100 });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(2);
    expect(animationFrameCallbacks.size).toBe(0);
  });

  it('keeps node interaction local and never starts canvas pan from a card', async () => {
    const user = userEvent.setup();
    render(<CostTreeCanvasDemo />);
    const viewport = screen.getByRole('region', { name: 'CostTree canvas demo' });
    const content = screen.getByTestId('cost-tree-content');
    const kernel = screen.getAllByRole('button', { name: /Inspect kernel/ })[0];
    if (kernel === undefined) throw new Error('Expected a demo kernel card.');
    const before = content.style.transform;

    fireEvent(kernel, pointerEvent('pointerdown', 7, 100, 100));
    fireEvent(viewport, pointerEvent('pointermove', 7, 260, 220));
    fireEvent(viewport, pointerEvent('pointerup', 7, 260, 220));
    expect(content.style.transform).toBe(before);

    await user.click(kernel);
    expect(kernel).toHaveAttribute('aria-pressed', 'true');
  });

  it('pans from non-interactive descendant space', () => {
    render(<CostTreeCanvasDemo />);
    const viewport = screen.getByRole('region', { name: 'CostTree canvas demo' });
    const content = screen.getByTestId('cost-tree-content');
    const before = content.style.transform;

    fireEvent(content, pointerEvent('pointerdown', 9, 40, 40));
    fireEvent(viewport, pointerEvent('pointermove', 9, 90, 70));
    fireEvent(viewport, pointerEvent('pointerup', 9, 90, 70));

    expect(content.style.transform).not.toBe(before);
    expect(viewport).toHaveStyle({ cursor: 'grab' });
  });
});
