import { Box } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import {
  RIBBON_ACTIVE_OPACITY,
  RIBBON_ACTIVE_WIDTH,
  RIBBON_IDLE_OPACITY,
  RIBBON_IDLE_WIDTH,
  ribbonCurves,
} from './mappingBoardLayout';
import type { BoardJoin } from './mappingBoardModel';

/**
 * The gutter: one curve per join the label file declares.
 *
 * Canvas rather than DOM, for the same reason `IterationTimelineCanvas` is: a
 * capture declares a few hundred joins and none of them is a box a reader can
 * click. It sits over the gap between the two columns and reads the cards'
 * measured positions, so a name that wraps or a viewport that narrows moves
 * the endpoints with the cards instead of drifting away from them.
 */

export interface RibbonEndpoints {
  /** Vertical centre of each measured card, relative to the canvas top.
   * `undefined` for a card that has not been laid out yet. */
  readonly measuredCenterY: readonly (number | undefined)[];
  readonly modelledCenterY: readonly (number | undefined)[];
}

export default function MappingBoardRibbons({
  joins,
  endpoints,
  height,
  isActive,
  label,
}: {
  readonly joins: readonly BoardJoin[];
  readonly endpoints: RibbonEndpoints;
  readonly height: number;
  readonly isActive: (join: BoardJoin) => boolean;
  readonly label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const measure = () => setWidth(host.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    for (const curve of ribbonCurves(
      joins,
      endpoints.measuredCenterY,
      endpoints.modelledCenterY,
      width,
      isActive,
    )) {
      context.globalAlpha = curve.active ? RIBBON_ACTIVE_OPACITY : RIBBON_IDLE_OPACITY;
      context.lineWidth = curve.active ? RIBBON_ACTIVE_WIDTH : RIBBON_IDLE_WIDTH;
      context.strokeStyle = curve.color;
      context.beginPath();
      context.moveTo(curve.startX, curve.startY);
      context.bezierCurveTo(
        curve.controlOutX,
        curve.controlOutY,
        curve.controlInX,
        curve.controlInY,
        curve.endX,
        curve.endY,
      );
      context.stroke();
    }
    context.globalAlpha = 1;
  }, [joins, endpoints, width, height, isActive]);

  return (
    <Box ref={hostRef} sx={{ position: 'relative', width: '100%', height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        style={{ display: 'block', width: '100%', height: `${height}px` }}
      />
    </Box>
  );
}
