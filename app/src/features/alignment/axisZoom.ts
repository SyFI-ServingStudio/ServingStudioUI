import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * One X-axis viewport model, shared by both of the page's canvases.
 *
 * §01 and §04 draw different things — a thousand-column band of iterations, and
 * a stack of measured and modelled lanes — but they ask the same question of a
 * reader: what happened HERE. A window over the data axis is the only state
 * that answers it, and writing that state twice would guarantee the two boards
 * drift into two different gestures.
 *
 * Only the X axis moves. Y stays on its full, self-fitting domain: on both
 * boards the vertical direction is several panels or lanes of different
 * quantities, and scaling them together makes every one of them unreadable at
 * once. A viewport is therefore a span on the DATA axis — iteration ordinals on
 * §01, milliseconds on §04 — never a pixel rectangle, so the drawing code keeps
 * placing points the way it already does and only the mapping changes.
 *
 * Everything above the hook is pure and tested in `axisZoom.test.ts`; the hook
 * is a thin binding of wheel, pointer and key events onto those functions.
 */

export interface AxisSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * How far in the viewport may be zoomed: the smallest visible span is this
 * fraction of the full domain.
 *
 * Relative rather than absolute, so an axis of iteration ordinals and an axis
 * of milliseconds reach the same depth in the same number of gestures. It is
 * also what keeps the span off zero — a zero-wide window has no anchor to zoom
 * around and no scale to draw with.
 */
export const MINIMUM_SPAN_FRACTION = 1 / 4096;

/** One key press zooms by this much; below 1 because a press zooms in. */
const KEYBOARD_ZOOM_FACTOR = 0.75;
/** One key press pans by this fraction of the visible span. */
const KEYBOARD_PAN_RATIO = 0.2;
/** A wheel notch is a few dozen pixels of delta, so this is the exponent per
 * pixel rather than per notch. */
const WHEEL_ZOOM_PER_PIXEL = 0.0022;
/** Ctrl+wheel is a deliberate precision gesture, so it moves half as far per
 * wheel unit while keeping the same pointer anchor. Plain wheel zoom remains
 * available for the existing canvas interaction. */
const CTRL_WHEEL_ZOOM_RATIO = 0.5;
/** `WheelEvent.deltaMode`: pixels, lines, pages. A line and a page have no
 * intrinsic size here, so both are read as the pixel count they stand in for. */
const DELTA_MODE_PIXELS = [1, 16, 400];

export const spanOf = (span: AxisSpan): number => span.end - span.start;

export function minimumSpanOf(domain: AxisSpan): number {
  const full = spanOf(domain);
  return full > 0 ? full * MINIMUM_SPAN_FRACTION : 0;
}

export const fullViewport = (domain: AxisSpan): AxisSpan => ({
  start: domain.start,
  end: domain.end,
});

/**
 * The viewport a domain will actually accept.
 *
 * Both bounds move together: a window wider than the domain is narrowed to it,
 * a window narrower than the zoom floor is widened to that floor, and the
 * result is then slid — not cropped — until it lies inside the domain, so
 * panning at either edge stops without also changing the zoom.
 */
export function clampViewport(viewport: AxisSpan, domain: AxisSpan): AxisSpan {
  const full = spanOf(domain);
  if (!(full > 0) || !Number.isFinite(viewport.start) || !Number.isFinite(viewport.end)) {
    return fullViewport(domain);
  }
  const span = Math.min(full, Math.max(minimumSpanOf(domain), spanOf(viewport)));
  const start = Math.min(domain.end - span, Math.max(domain.start, viewport.start));
  return { start, end: start + span };
}

/**
 * Zoom around a fixed point.
 *
 * `anchorRatio` is where that point sits in the CURRENT window, 0 at its left
 * edge and 1 at its right; the data value under it is what stays still. That is
 * what makes a wheel gesture read as zooming the thing under the pointer rather
 * than the middle of the plot. A factor below 1 zooms in.
 */
export function zoomViewport(
  viewport: AxisSpan,
  domain: AxisSpan,
  anchorRatio: number,
  factor: number,
): AxisSpan {
  const span = spanOf(viewport);
  if (!(span > 0) || !(factor > 0) || !Number.isFinite(anchorRatio)) {
    return clampViewport(viewport, domain);
  }
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchorValue = viewport.start + span * ratio;
  const nextSpan = Math.min(spanOf(domain), Math.max(minimumSpanOf(domain), span * factor));
  const start = anchorValue - nextSpan * ratio;
  return clampViewport({ start, end: start + nextSpan }, domain);
}

/** Slide the window by a fraction of what it currently shows. */
export function panViewport(viewport: AxisSpan, domain: AxisSpan, spanRatio: number): AxisSpan {
  if (!Number.isFinite(spanRatio)) return clampViewport(viewport, domain);
  const shift = spanOf(viewport) * spanRatio;
  return clampViewport({ start: viewport.start + shift, end: viewport.end + shift }, domain);
}

/** Whether the window still shows everything, which is what decides if a reset
 * control has anything to undo. */
export function isFullViewport(viewport: AxisSpan, domain: AxisSpan): boolean {
  const full = spanOf(domain);
  if (!(full > 0)) return true;
  return spanOf(viewport) >= full * (1 - 1e-9);
}

/** The share of the domain on screen, as a percentage the page's own formatter
 * can print. */
export function viewportPercent(viewport: AxisSpan, domain: AxisSpan): number {
  const full = spanOf(domain);
  return full > 0 ? (spanOf(viewport) / full) * 100 : 100;
}

// ---- pointer geometry -----------------------------------------------------

/** Where the plot area sits inside its surface, as fractions of the surface's
 * width. Fractions rather than pixels because §01's gutters are stated in a
 * fixed coordinate space that scales with the card, while §04's are CSS pixels
 * on a surface that does not. */
export interface PlotInsets {
  readonly leftFraction: number;
  readonly rightFraction: number;
}

export const WHOLE_SURFACE_INSETS: PlotInsets = { leftFraction: 0, rightFraction: 0 };

export function plotInsets(leftPx: number, rightPx: number, widthPx: number): PlotInsets {
  if (!(widthPx > 0)) return WHOLE_SURFACE_INSETS;
  const leftFraction = Math.max(0, Math.min(1, leftPx / widthPx));
  const rightFraction = Math.max(0, Math.min(1 - leftFraction, rightPx / widthPx));
  return { leftFraction, rightFraction };
}

/** What a `getBoundingClientRect` supplies, named so a test can hand over two
 * numbers instead of a DOM rect. */
export interface SurfaceBounds {
  readonly left: number;
  readonly width: number;
}

const plotWidthOf = (bounds: SurfaceBounds, insets: PlotInsets): number =>
  bounds.width * (1 - insets.leftFraction - insets.rightFraction);

/** Where a client x sits in the plot area, 0…1. Clamped, so a gesture that
 * starts on the axis gutter still zooms around the nearest edge. */
export function anchorRatioAt(clientX: number, bounds: SurfaceBounds, insets: PlotInsets): number {
  const plotWidth = plotWidthOf(bounds, insets);
  if (!(plotWidth > 0)) return 0.5;
  const offset = clientX - bounds.left - bounds.width * insets.leftFraction;
  return Math.min(1, Math.max(0, offset / plotWidth));
}

/** How much of the visible span a horizontal drag moves. Negative for a drag to
 * the right, because the data has to follow the pointer rather than flee it. */
export function dragPanRatio(deltaXPx: number, bounds: SurfaceBounds, insets: PlotInsets): number {
  const plotWidth = plotWidthOf(bounds, insets);
  return plotWidth > 0 ? -deltaXPx / plotWidth : 0;
}

export function wheelZoomFactor(deltaY: number, deltaMode = 0, ctrlKey = false): number {
  if (!Number.isFinite(deltaY)) return 1;
  const modifierRatio = ctrlKey ? CTRL_WHEEL_ZOOM_RATIO : 1;
  return Math.exp(
    deltaY * (DELTA_MODE_PIXELS[deltaMode] ?? 1) * WHEEL_ZOOM_PER_PIXEL * modifierRatio,
  );
}

// ---- keyboard -------------------------------------------------------------

export type AxisZoomKeyAction = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'reset';

/**
 * The one keyboard vocabulary both boards answer to.
 *
 * Each zoom key is listed under both of its spellings, because `+` and `_` need
 * a shift the reader has no reason to hold and the unshifted key is the same
 * physical press.
 */
export function axisZoomKeyAction(key: string): AxisZoomKeyAction | null {
  switch (key) {
    case '+':
    case '=':
      return 'zoom-in';
    case '-':
    case '_':
      return 'zoom-out';
    case 'ArrowLeft':
      return 'pan-left';
    case 'ArrowRight':
      return 'pan-right';
    case '0':
    case 'Escape':
      return 'reset';
    default:
      return null;
  }
}

export function applyKeyAction(
  viewport: AxisSpan,
  domain: AxisSpan,
  action: AxisZoomKeyAction,
): AxisSpan {
  switch (action) {
    case 'zoom-in':
      return zoomViewport(viewport, domain, 0.5, KEYBOARD_ZOOM_FACTOR);
    case 'zoom-out':
      return zoomViewport(viewport, domain, 0.5, 1 / KEYBOARD_ZOOM_FACTOR);
    case 'pan-left':
      return panViewport(viewport, domain, -KEYBOARD_PAN_RATIO);
    case 'pan-right':
      return panViewport(viewport, domain, KEYBOARD_PAN_RATIO);
    case 'reset':
      return fullViewport(domain);
  }
}

// ---- the binding ----------------------------------------------------------

export interface AxisZoomSurfaceProps {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDoubleClick: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface AxisZoomHandle {
  readonly viewport: AxisSpan;
  readonly isFull: boolean;
  readonly isPanning: boolean;
  readonly reset: () => void;
  /** Attach to the element the gestures are read from. It is a callback ref
   * because the wheel listener can only be registered once the element exists,
   * and it must be registered natively — React's own `onWheel` is passive, and
   * a passive listener cannot stop the page from scrolling underneath. */
  readonly surfaceRef: (element: HTMLElement | null) => void;
  readonly surfaceProps: AxisZoomSurfaceProps;
}

export function useAxisZoom(domain: AxisSpan, insets: PlotInsets): AxisZoomHandle {
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const [viewport, setViewport] = useState<AxisSpan>(() => fullViewport(domain));
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef<{ pointerId: number; clientX: number } | null>(null);
  const domainRef = useRef(domain);
  const insetsRef = useRef(insets);

  // Gestures run between renders, so the current domain and insets are read
  // through refs rather than captured in each handler's dependency list: both
  // objects are rebuilt on every render, and a wheel listener that re-registered
  // that often would drop events in the middle of a gesture.
  useEffect(() => {
    domainRef.current = domain;
    insetsRef.current = insets;
  });

  const appliedDomainRef = useRef<AxisSpan | null>(null);
  const { start, end } = domain;
  useEffect(() => {
    // A new domain is a new axis — another iteration selected, another time
    // basis charted — and a window kept across that would frame data that is no
    // longer under it. The first run is the mount, where the initial state
    // already holds this domain and re-setting it would cost a second render.
    const applied = appliedDomainRef.current;
    appliedDomainRef.current = { start, end };
    if (applied !== null) setViewport({ start, end });
  }, [start, end]);

  useEffect(() => {
    if (surface === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = anchorRatioAt(
        event.clientX,
        surface.getBoundingClientRect(),
        insetsRef.current,
      );
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey);
      setViewport((current) => zoomViewport(current, domainRef.current, anchor, factor));
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [surface]);

  const reset = useCallback(() => setViewport(fullViewport(domainRef.current)), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const ratio = dragPanRatio(
      event.clientX - drag.clientX,
      event.currentTarget.getBoundingClientRect(),
      insetsRef.current,
    );
    // Each move pans by its own step rather than by the distance from where the
    // gesture began: the span shrinks as the drag crosses a clamped edge, and a
    // ratio measured from the start would then jump when the edge is left.
    drag.clientX = event.clientX;
    setViewport((current) => panViewport(current, domainRef.current, ratio));
  }, []);

  const endPan = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const action = axisZoomKeyAction(event.key);
    if (action === null) return;
    event.preventDefault();
    setViewport((current) => applyKeyAction(current, domainRef.current, action));
  }, []);

  const surfaceProps: AxisZoomSurfaceProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerCancel: endPan,
    onDoubleClick: reset,
    onKeyDown,
  };

  return {
    viewport,
    isFull: isFullViewport(viewport, domain),
    isPanning,
    reset,
    surfaceRef: setSurface,
    surfaceProps,
  };
}
