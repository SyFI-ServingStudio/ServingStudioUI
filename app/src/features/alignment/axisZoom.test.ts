import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  MINIMUM_SPAN_FRACTION,
  anchorRatioAt,
  applyKeyAction,
  axisZoomKeyAction,
  clampViewport,
  dragPanRatio,
  fullViewport,
  isFullViewport,
  minimumSpanOf,
  panViewport,
  plotInsets,
  spanOf,
  useAxisZoom,
  viewportPercent,
  wheelZoomFactor,
  zoomViewport,
  type AxisSpan,
} from './axisZoom';

/**
 * The viewport model, which is the whole of what a zoom gesture means.
 *
 * Every case here is a property a reader would notice the moment it broke: the
 * point under the pointer staying put, the window never leaving the data, and a
 * span that cannot collapse to nothing however long the wheel is turned.
 */

const domain: AxisSpan = { start: 0, end: 100 };
/** A gutter on each side, as both boards have. */
const insets = plotInsets(80, 20, 400);
const bounds = { left: 50, width: 400 };

describe('clampViewport', () => {
  it('keeps a window that already fits', () => {
    expect(clampViewport({ start: 20, end: 60 }, domain)).toEqual({ start: 20, end: 60 });
  });

  it('narrows a window wider than the data to exactly the data', () => {
    expect(clampViewport({ start: -50, end: 500 }, domain)).toEqual(domain);
  });

  it('slides a window that runs past an edge instead of cropping it', () => {
    // Both edges: the span is what the reader chose, so it survives and only
    // the position gives way.
    expect(clampViewport({ start: 80, end: 120 }, domain)).toEqual({ start: 60, end: 100 });
    expect(clampViewport({ start: -30, end: 10 }, domain)).toEqual({ start: 0, end: 40 });
  });

  it('widens a window below the zoom floor to that floor', () => {
    const clamped = clampViewport({ start: 50, end: 50 }, domain);
    expect(spanOf(clamped)).toBeCloseTo(minimumSpanOf(domain), 12);
    expect(minimumSpanOf(domain)).toBe(100 * MINIMUM_SPAN_FRACTION);
    expect(minimumSpanOf(domain)).toBeGreaterThan(0);
  });

  it('falls back to the whole domain for a window that is not a range', () => {
    expect(clampViewport({ start: Number.NaN, end: 10 }, domain)).toEqual(domain);
    expect(clampViewport({ start: 4, end: 4 }, { start: 7, end: 7 })).toEqual({
      start: 7,
      end: 7,
    });
  });
});

describe('zoomViewport', () => {
  it('allows the timeline to zoom past the former 1/1024 floor', () => {
    const zoomed = zoomViewport(domain, domain, 0.5, 1 / 2048);

    expect(spanOf(zoomed)).toBeCloseTo(100 / 2048, 12);
  });

  it('leaves the value under the anchor where it was', () => {
    const viewport = { start: 0, end: 100 };
    const anchorRatio = 0.25;
    const anchorValue = viewport.start + spanOf(viewport) * anchorRatio;
    const zoomed = zoomViewport(viewport, domain, anchorRatio, 0.5);
    expect(zoomed.start + spanOf(zoomed) * anchorRatio).toBeCloseTo(anchorValue, 12);
    expect(spanOf(zoomed)).toBeCloseTo(50, 12);
  });

  it('zooms around the pointer rather than the middle', () => {
    const left = zoomViewport({ start: 0, end: 100 }, domain, 0, 0.5);
    const right = zoomViewport({ start: 0, end: 100 }, domain, 1, 0.5);
    expect(left).toEqual({ start: 0, end: 50 });
    expect(right).toEqual({ start: 50, end: 100 });
  });

  it('never opens wider than the data, however far out the gesture goes', () => {
    let viewport = { start: 40, end: 60 };
    for (let step = 0; step < 40; step += 1) {
      viewport = zoomViewport(viewport, domain, 0.5, 1.5);
    }
    expect(viewport).toEqual(domain);
    expect(isFullViewport(viewport, domain)).toBe(true);
  });

  it('stops at a visible span rather than collapsing onto a point', () => {
    let viewport = fullViewport(domain);
    for (let step = 0; step < 200; step += 1) {
      viewport = zoomViewport(viewport, domain, 0.5, 0.5);
    }
    expect(spanOf(viewport)).toBeCloseTo(minimumSpanOf(domain), 12);
    expect(spanOf(viewport)).toBeGreaterThan(0);
    expect(viewport.start).toBeGreaterThanOrEqual(domain.start);
    expect(viewport.end).toBeLessThanOrEqual(domain.end);
  });

  it('holds the window inside the data when the anchor sits at an edge', () => {
    const zoomed = zoomViewport({ start: 0, end: 20 }, domain, 0, 2);
    expect(zoomed).toEqual({ start: 0, end: 40 });
  });
});

describe('panViewport', () => {
  it('slides by a fraction of what is on screen', () => {
    expect(panViewport({ start: 20, end: 40 }, domain, 0.5)).toEqual({ start: 30, end: 50 });
    expect(panViewport({ start: 20, end: 40 }, domain, -0.5)).toEqual({ start: 10, end: 30 });
  });

  it('stops at either edge without changing the zoom', () => {
    const atStart = panViewport({ start: 0, end: 20 }, domain, -5);
    const atEnd = panViewport({ start: 80, end: 100 }, domain, 5);
    expect(atStart).toEqual({ start: 0, end: 20 });
    expect(atEnd).toEqual({ start: 80, end: 100 });
    expect(spanOf(atStart)).toBe(20);
    expect(spanOf(atEnd)).toBe(20);
  });

  it('cannot pan a full window anywhere', () => {
    expect(panViewport(fullViewport(domain), domain, 0.9)).toEqual(domain);
  });
});

describe('isFullViewport and viewportPercent', () => {
  it('reports a reset window as full and a zoomed one as a share of the data', () => {
    expect(isFullViewport(fullViewport(domain), domain)).toBe(true);
    expect(isFullViewport({ start: 0, end: 99 }, domain)).toBe(false);
    expect(viewportPercent({ start: 10, end: 35 }, domain)).toBeCloseTo(25, 12);
    expect(viewportPercent(fullViewport(domain), domain)).toBe(100);
  });

  it('treats an empty domain as showing everything there is', () => {
    expect(isFullViewport({ start: 3, end: 3 }, { start: 3, end: 3 })).toBe(true);
    expect(viewportPercent({ start: 3, end: 3 }, { start: 3, end: 3 })).toBe(100);
  });
});

describe('pointer geometry', () => {
  it('states the gutters as fractions, so a scaled coordinate space carries', () => {
    expect(plotInsets(80, 20, 400)).toEqual({ leftFraction: 0.2, rightFraction: 0.05 });
    // The same gutters in a space twice as wide are the same fractions.
    expect(plotInsets(160, 40, 800)).toEqual({ leftFraction: 0.2, rightFraction: 0.05 });
    expect(plotInsets(80, 20, 0)).toEqual({ leftFraction: 0, rightFraction: 0 });
  });

  it('reads a client x as a position inside the plot, not inside the surface', () => {
    // Plot runs from 50 + 80 to 50 + 400 − 20.
    expect(anchorRatioAt(130, bounds, insets)).toBeCloseTo(0, 12);
    expect(anchorRatioAt(430, bounds, insets)).toBeCloseTo(1, 12);
    expect(anchorRatioAt(280, bounds, insets)).toBeCloseTo(0.5, 12);
  });

  it('clamps a gesture that starts on the axis gutter to the nearest edge', () => {
    expect(anchorRatioAt(0, bounds, insets)).toBe(0);
    expect(anchorRatioAt(10_000, bounds, insets)).toBe(1);
    expect(anchorRatioAt(100, { left: 0, width: 0 }, insets)).toBe(0.5);
  });

  it('pans against the drag, so the data follows the pointer', () => {
    // 300 px of plot: dragging 150 px right moves the window half a span back.
    expect(dragPanRatio(150, bounds, insets)).toBeCloseTo(-0.5, 12);
    expect(dragPanRatio(-150, bounds, insets)).toBeCloseTo(0.5, 12);
    expect(dragPanRatio(150, { left: 0, width: 0 }, insets)).toBe(0);
  });

  it('zooms out on a downward wheel and in on an upward one', () => {
    expect(wheelZoomFactor(120)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-120)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    // A line and a page stand for more pixels than a pixel does.
    expect(wheelZoomFactor(3, 1)).toBeGreaterThan(wheelZoomFactor(3, 0));
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
  });
});

describe('the keyboard vocabulary', () => {
  it('reads both spellings of a zoom key and both ways out', () => {
    expect(axisZoomKeyAction('+')).toBe('zoom-in');
    expect(axisZoomKeyAction('=')).toBe('zoom-in');
    expect(axisZoomKeyAction('-')).toBe('zoom-out');
    expect(axisZoomKeyAction('ArrowLeft')).toBe('pan-left');
    expect(axisZoomKeyAction('ArrowRight')).toBe('pan-right');
    expect(axisZoomKeyAction('0')).toBe('reset');
    expect(axisZoomKeyAction('Escape')).toBe('reset');
    expect(axisZoomKeyAction('a')).toBeNull();
  });

  it('zooms about the middle, pans by a fixed share, and resets to the data', () => {
    const viewport = { start: 20, end: 60 };
    const zoomedIn = applyKeyAction(viewport, domain, 'zoom-in');
    expect(spanOf(zoomedIn)).toBeLessThan(spanOf(viewport));
    expect(zoomedIn.start + spanOf(zoomedIn) / 2).toBeCloseTo(40, 12);
    expect(spanOf(applyKeyAction(viewport, domain, 'zoom-out'))).toBeGreaterThan(spanOf(viewport));
    expect(applyKeyAction(viewport, domain, 'pan-right').start).toBeGreaterThan(viewport.start);
    expect(applyKeyAction(viewport, domain, 'pan-left').start).toBeLessThan(viewport.start);
    expect(applyKeyAction(viewport, domain, 'reset')).toEqual(domain);
  });
});

// ---- the binding ----------------------------------------------------------

function surfaceElement(): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({ ...bounds, top: 0, height: 100 }) as DOMRect;
  document.body.append(element);
  return element;
}

const pointerAt = (clientX: number, pointerId = 1): ReactPointerEvent<HTMLElement> =>
  ({
    button: 0,
    pointerId,
    clientX,
    currentTarget: {
      getBoundingClientRect: () => bounds,
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    },
  }) as unknown as ReactPointerEvent<HTMLElement>;

const keyPress = (key: string): ReactKeyboardEvent<HTMLElement> =>
  ({ key, preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent<HTMLElement>;

describe('useAxisZoom', () => {
  it('starts on the whole domain', () => {
    const { result } = renderHook(() => useAxisZoom(domain, insets));
    expect(result.current.viewport).toEqual(domain);
    expect(result.current.isFull).toBe(true);
  });

  it('zooms a wheel gesture around the pointer, and stops the page scrolling', () => {
    const element = surfaceElement();
    const { result } = renderHook(() => useAxisZoom(domain, insets));
    act(() => result.current.surfaceRef(element));

    // Client x 130 is the plot's left edge, so the data there must stay there.
    const wheel = new WheelEvent('wheel', { deltaY: -240, clientX: 130, cancelable: true });
    act(() => {
      element.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(spanOf(result.current.viewport)).toBeLessThan(spanOf(domain));
    expect(result.current.viewport.start).toBeCloseTo(domain.start, 12);
    expect(result.current.isFull).toBe(false);

    act(() => result.current.reset());
    expect(result.current.viewport).toEqual(domain);
  });

  it('accepts ctrl+wheel as a slower precision zoom gesture', () => {
    const plain = wheelZoomFactor(-240);
    const modified = wheelZoomFactor(-240, 0, true);
    expect(modified).toBeLessThan(1);
    expect(modified).toBeGreaterThan(plain);
  });

  it('pans while a pointer is held and says so, so the cursor can change', () => {
    const { result } = renderHook(() => useAxisZoom(domain, insets));
    act(() => result.current.surfaceProps.onPointerDown(pointerAt(200)));
    expect(result.current.isPanning).toBe(true);

    // A window has to be narrower than the data before panning can move it.
    act(() => result.current.surfaceProps.onKeyDown(keyPress('+')));
    const before = result.current.viewport.start;
    act(() => result.current.surfaceProps.onPointerMove(pointerAt(140)));
    expect(result.current.viewport.start).toBeGreaterThan(before);

    act(() => result.current.surfaceProps.onPointerUp(pointerAt(140)));
    expect(result.current.isPanning).toBe(false);

    // A move after the gesture ended is not a pan.
    const settled = result.current.viewport;
    act(() => result.current.surfaceProps.onPointerMove(pointerAt(20)));
    expect(result.current.viewport).toBe(settled);
  });

  it('ignores a pointer that is not the one that started the gesture', () => {
    const { result } = renderHook(() => useAxisZoom(domain, insets));
    act(() => result.current.surfaceProps.onKeyDown(keyPress('+')));
    const zoomed = result.current.viewport;
    act(() => result.current.surfaceProps.onPointerDown(pointerAt(200, 1)));
    act(() => result.current.surfaceProps.onPointerMove(pointerAt(20, 2)));
    expect(result.current.viewport).toBe(zoomed);
  });

  it('answers the keyboard and takes a double click as the way out', () => {
    const { result } = renderHook(() => useAxisZoom(domain, insets));
    const zoomIn = keyPress('+');
    act(() => result.current.surfaceProps.onKeyDown(zoomIn));
    expect(zoomIn.preventDefault).toHaveBeenCalled();
    expect(result.current.isFull).toBe(false);

    act(() => result.current.surfaceProps.onKeyDown(keyPress('ArrowRight')));
    expect(result.current.viewport.end).toBeLessThanOrEqual(domain.end);

    act(() => result.current.surfaceProps.onDoubleClick());
    expect(result.current.viewport).toEqual(domain);

    // A key the model has no meaning for is left to whoever else wants it.
    const other = keyPress('a');
    act(() => result.current.surfaceProps.onKeyDown(other));
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it('opens onto the whole of a domain that has been replaced', () => {
    const { result, rerender } = renderHook(({ span }) => useAxisZoom(span, insets), {
      initialProps: { span: domain },
    });
    act(() => result.current.surfaceProps.onKeyDown(keyPress('+')));
    expect(result.current.isFull).toBe(false);

    const next = { start: 200, end: 300 };
    rerender({ span: next });
    expect(result.current.viewport).toEqual(next);
  });
});
