import { chartFont } from '../../ui/theme/metrics';
import { Box } from '@mui/material';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { tokens } from '../../ui/theme';
import type { AxisZoomHandle } from './axisZoom';
import type { PairedScene, PlotShape } from './pairedIterationsScene';

/**
 * The §01 plot surface.
 *
 * A 2D canvas, drawn in the scene's own fixed coordinate space and scaled to
 * whatever width the card gets, so type sizes and gaps keep their designed
 * ratio at every viewport. It owns no arithmetic: the shapes arrive placed.
 */

function applyFont(
  context: CanvasRenderingContext2D,
  shape: Extract<PlotShape, { kind: 'text' }>,
): void {
  context.font = `${shape.weight ?? 400} ${chartFont(shape.size)}px ${tokens.mono}`;
  // Not every engine implements canvas letter spacing; where it is missing the
  // label simply sets tighter, which is preferable to measuring glyphs here.
  if ('letterSpacing' in context) {
    context.letterSpacing = shape.tracking === undefined ? '0em' : `${shape.tracking}em`;
  }
}

function tracePolyline(
  context: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
}

function paintShape(context: CanvasRenderingContext2D, shape: PlotShape): void {
  switch (shape.kind) {
    case 'rect': {
      context.beginPath();
      if (shape.radius === undefined) {
        context.rect(shape.x, shape.y, shape.width, shape.height);
      } else {
        context.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius);
      }
      if (shape.fill !== undefined) {
        context.fillStyle = shape.fill;
        context.fill();
      }
      if (shape.stroke !== undefined) {
        context.strokeStyle = shape.stroke;
        context.lineWidth = shape.strokeWidth ?? 1;
        context.stroke();
      }
      return;
    }
    case 'polygon': {
      tracePolyline(context, shape.points);
      context.closePath();
      context.globalAlpha = shape.alpha;
      context.fillStyle = shape.fill;
      context.fill();
      context.globalAlpha = 1;
      return;
    }
    case 'polyline': {
      tracePolyline(context, shape.points);
      context.setLineDash(shape.dash === undefined ? [] : [...shape.dash]);
      context.strokeStyle = shape.stroke;
      context.lineWidth = shape.width;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();
      context.setLineDash([]);
      return;
    }
    case 'dot': {
      context.beginPath();
      context.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
      context.fillStyle = shape.fill;
      context.fill();
      if (shape.stroke !== undefined) {
        context.strokeStyle = shape.stroke;
        context.lineWidth = shape.strokeWidth ?? 1;
        context.stroke();
      }
      return;
    }
    case 'text': {
      applyFont(context, shape);
      context.textAlign = shape.align === 'center' ? 'center' : shape.align;
      context.textBaseline = 'alphabetic';
      context.fillStyle = shape.fill;
      context.fillText(shape.text, shape.x, shape.y);
      if ('letterSpacing' in context) context.letterSpacing = '0em';
      return;
    }
    case 'clip': {
      context.save();
      context.beginPath();
      context.rect(shape.x, shape.y, shape.width, shape.height);
      context.clip();
      return;
    }
    case 'unclip': {
      context.restore();
      return;
    }
  }
}

export default function PairedIterationsCanvas({
  scene,
  overlay,
  ariaLabel,
  zoom,
  onHoverRatio,
}: {
  readonly scene: PairedScene;
  readonly overlay: readonly PlotShape[];
  readonly ariaLabel: string;
  /** The shared x-axis viewport. The card owns it, because the placement it
   * changes happens in the layout the card builds, not here. */
  readonly zoom: AxisZoomHandle;
  /** Where the pointer is, as a fraction of the plot's full width. */
  readonly onHoverRatio: (ratio: number | null) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(scene.width);
  const { surfaceRef } = zoom;

  // One element carries the size observation and the gestures, so the rect a
  // wheel anchor is measured against is the rect the plot was drawn into.
  const attachFrame = useCallback(
    (element: HTMLDivElement | null) => {
      frameRef.current = element;
      surfaceRef(element);
    },
    [surfaceRef],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const updateWidth = () => setFrameWidth(Math.max(1, frame.getBoundingClientRect().width));
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const scale = frameWidth / scene.width;
  const cssHeight = scene.height * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(frameWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
    const context = canvas.getContext('2d');
    if (context === null) return;
    const unit = pixelRatio * scale;
    context.setTransform(unit, 0, 0, unit, 0, 0);
    context.clearRect(0, 0, scene.width, scene.height);
    for (const shape of scene.shapes) paintShape(context, shape);
    for (const shape of overlay) paintShape(context, shape);
  }, [scene, overlay, frameWidth, cssHeight, scale]);

  const reportRatio = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    onHoverRatio((event.clientX - box.left) / box.width);
  };

  return (
    <Box
      ref={attachFrame}
      role="application"
      tabIndex={0}
      aria-label={ariaLabel}
      {...zoom.surfaceProps}
      onPointerMove={(event) => {
        zoom.surfaceProps.onPointerMove(event);
        reportRatio(event);
      }}
      onPointerLeave={() => onHoverRatio(null)}
      sx={{
        width: '100%',
        // Vertical page scrolling still belongs to the page; the horizontal
        // direction is the axis's own.
        touchAction: 'pan-y',
        cursor: zoom.isPanning ? 'grabbing' : 'grab',
        userSelect: 'none',
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 2 },
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: 'block', width: '100%', height: cssHeight }}
      />
    </Box>
  );
}
