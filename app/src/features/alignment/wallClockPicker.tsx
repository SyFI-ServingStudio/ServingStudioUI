import { chartFont } from '../../theme/metrics';
import { Box } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { AlignmentTimelineIterationSummary } from '../../domain/alignment';
import { tokens } from '../../theme';
import { fmtInt, fmtPct } from './format';
import { iterationTypeColor, iterationTypeOrder } from './iterationPalette';
import { withAlpha } from './wallClockPalette';
import {
  PICKER,
  pickerBars,
  pickerCaptionAlign,
  pickerFractionY,
  pickerRulerStep,
  pickerScrollLeft,
  pickerSlotAt,
  pickerTicks,
  pickerTopFraction,
  pickerWidth,
} from './wallClockPickerModel';

/**
 * Every iteration in the capture, one bar each, in a scroller.
 *
 * Two canvases, not one: the scale would be the first thing to slide out of
 * view inside the scroller, so it is drawn separately and stays put while the
 * bars move under it. Hit testing is one handler over the whole surface rather
 * than 2,000 of them.
 */
export default function WallClockPicker({
  iterations,
  ordered,
  selectedIterationId,
  onSelectIteration,
  onStep,
  orderLabel,
}: {
  iterations: readonly AlignmentTimelineIterationSummary[];
  ordered: readonly number[];
  selectedIterationId: number | null;
  onSelectIteration: (iterationId: number) => void;
  onStep: (delta: number) => void;
  orderLabel: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const barsCanvasRef = useRef<HTMLCanvasElement>(null);
  const axisCanvasRef = useRef<HTMLCanvasElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const topFraction = useMemo(() => pickerTopFraction(iterations), [iterations]);
  const bars = useMemo(
    () => pickerBars(iterations, ordered, topFraction, selectedIterationId),
    [iterations, ordered, topFraction, selectedIterationId],
  );
  const width = pickerWidth(ordered.length);
  const selectedSlot = bars.findIndex((bar) => bar.selected);
  const typeOrder = useMemo(
    () => iterationTypeOrder(iterations.map((row) => row.iterationType)),
    [iterations],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = axisCanvasRef.current;
    if (canvas === null) return;
    const context = prepareCanvas(canvas, PICKER.axisWidth, PICKER.height);
    if (context === null) return;
    context.textAlign = 'right';
    context.font = `${chartFont(9)}px ${tokens.mono}`;
    context.fillStyle = tokens.sub2;
    for (const tick of pickerTicks(topFraction)) {
      context.fillText(
        fmtInt(tick * 100),
        PICKER.axisWidth - 6,
        pickerFractionY(tick, topFraction) + 3,
      );
    }
    context.fillText('0', PICKER.axisWidth - 6, PICKER.top + PICKER.barsHeight + 3);
    context.strokeStyle = tokens.hair;
    context.beginPath();
    context.moveTo(PICKER.axisWidth - 2, PICKER.top);
    context.lineTo(PICKER.axisWidth - 2, PICKER.top + PICKER.barsHeight);
    context.stroke();
  }, [topFraction]);

  useEffect(() => {
    const canvas = barsCanvasRef.current;
    if (canvas === null) return;
    const context = prepareCanvas(canvas, width, PICKER.height);
    if (context === null) return;

    context.strokeStyle = withAlpha(tokens.hair, 0.9);
    context.lineWidth = 1;
    for (const tick of pickerTicks(topFraction)) {
      const y = pickerFractionY(tick, topFraction);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width - PICKER.trailingWidth, y);
      context.stroke();
    }
    context.strokeStyle = tokens.hair;
    context.beginPath();
    context.moveTo(0, PICKER.top + PICKER.barsHeight);
    context.lineTo(width - PICKER.trailingWidth, PICKER.top + PICKER.barsHeight);
    context.stroke();

    for (const bar of bars) {
      context.globalAlpha = bar.selected ? 1 : 0.62;
      context.fillStyle = iterationTypeColor(bar.iterationType, typeOrder);
      context.fillRect(bar.x, bar.y, PICKER.barWidth, bar.height);
    }
    context.globalAlpha = 1;

    const step = pickerRulerStep(ordered.length, width);
    context.fillStyle = tokens.sub2;
    context.font = `${chartFont(9)}px ${tokens.mono}`;
    context.textAlign = 'center';
    bars.forEach((bar, slot) => {
      if (slot % step !== 0) return;
      // The first label sits on the scroller's left edge, where a centred one
      // would be half cut off; it faces inwards instead.
      context.textAlign = slot === 0 ? 'left' : 'center';
      context.fillText(
        String(bar.iterationId),
        slot === 0 ? bar.x : bar.x + PICKER.barWidth / 2,
        PICKER.top + PICKER.barsHeight + 14,
      );
    });

    const selected = bars[selectedSlot];
    if (selected === undefined) return;
    context.strokeStyle = tokens.ink;
    context.lineWidth = 1.3;
    context.strokeRect(selected.x - 3, PICKER.top - 2, PICKER.barWidth + 6, PICKER.barsHeight + 4);
    const row = iterations[selected.index];
    context.fillStyle = tokens.ink;
    context.textAlign = pickerCaptionAlign(selectedSlot, ordered.length);
    context.fillText(
      `${row.iterationId} · ${row.iterationType} · idle ${fmtPct(row.idleFraction * 100)}`,
      selected.x + PICKER.barWidth / 2,
      PICKER.top - 5,
    );
  }, [bars, iterations, ordered.length, selectedSlot, topFraction, typeOrder, width]);

  // Keep the selection in view when it moves by keyboard rather than by click.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || selectedSlot < 0 || viewportWidth <= 0) return;
    scroller.scrollLeft = pickerScrollLeft(selectedSlot, viewportWidth, ordered.length);
  }, [selectedSlot, viewportWidth, ordered.length]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
      <canvas
        ref={axisCanvasRef}
        aria-hidden="true"
        style={{ width: PICKER.axisWidth, height: PICKER.height, flex: 'none', display: 'block' }}
      />
      <Box
        ref={scrollerRef}
        sx={{
          overflowX: 'auto',
          overflowY: 'hidden',
          cursor: 'pointer',
          scrollbarWidth: 'thin',
          flex: 1,
          minWidth: 0,
        }}
      >
        <Box
          component="canvas"
          ref={barsCanvasRef}
          role="img"
          tabIndex={0}
          aria-label={`Every iteration in the capture, ${orderLabel}, bar height is the fraction of the span the GPU was idle`}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const slot = pickerSlotAt(event.clientX - bounds.left, ordered.length);
            const bar = bars[slot];
            if (bar !== undefined) onSelectIteration(bar.iterationId);
          }}
          onKeyDown={(event) => {
            const steps: Readonly<Record<string, number>> = {
              ArrowLeft: -1,
              ArrowRight: 1,
              PageUp: -25,
              PageDown: 25,
            };
            const delta =
              event.key === 'Home'
                ? -ordered.length
                : event.key === 'End'
                  ? ordered.length
                  : steps[event.key];
            if (delta === undefined) return;
            event.preventDefault();
            onStep(delta);
          }}
          sx={{
            width,
            height: PICKER.height,
            display: 'block',
            flex: 'none',
            outline: 'none',
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: '-2px' },
          }}
        />
      </Box>
    </Box>
  );
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}
