import { Box } from '@mui/material';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { tokens } from '../../theme';
import { plotInsets, useAxisZoom, type AxisSpan } from './axisZoom';
import AxisZoomFootnote from './AxisZoomFootnote';
import { HOST_NVTX_DEPTHS, type HostLaneCensus, type HostLaneGroup } from './hostLanes';
import {
  axisWindowNote,
  niceTicks,
  sceneDomain,
  type ContinuousScene,
  type IterationLane,
} from './timelineGeometry';
import {
  apiRows,
  connectedTraceIds,
  traceConnections,
  traceFromBar,
  traceFromApi,
  type TimelineTrace,
} from './timelineSelection';
import { apiClassColor, laneBandColor, nvtxDepthColor, withAlpha } from './wallClockPalette';

/**
 * Three consecutive iterations, host lanes above device lanes, on one canvas.
 *
 * Canvas rather than SVG or a chart library: an iteration carries hundreds of
 * measured kernels, hundreds of modelled slot repeats and thousands of host
 * events, and every one of them is a rectangle with no axis semantics. This is
 * the same construction `WorkerOperationTimeline` uses, for the same reason.
 *
 * The host lanes sit ABOVE the device lanes because that is the order things
 * happen in: a GPU gap under a run of launches is the device behind the host, a
 * GPU gap under an idle host is the other way round, and the model has no lane
 * at all up there.
 *
 * Every millisecond value reaching this file is already on the shared axis —
 * `continuousScene` rebased the kernels and `groupedHostLanes` offset the host
 * rows — so nothing here subtracts an anchor. Doing that a second time on the
 * host side shifts those lanes off the axis by the whole capture offset.
 */

/** Every measured/modelled work bar uses one height so colour and width remain
 * the only visual channels for operation identity and duration. */
const UNIFIED_BAR_HEIGHT = 16;

/** Vertical geometry, in CSS pixels. The lanes are a fixed stack: their heights
 * are what says which lane is which, so they do not breathe with the container. */
const LAYOUT = {
  labelY: 16,
  schedulerY: 30,
  schedulerHeight: 12,
  nvtxY: 51,
  nvtxHeight: 14,
  nvtxGap: 3,
  apiY: 104,
  apiHeight: 21,
  helperY: 131,
  helperHeight: 13,
  gpuY: 160,
  gpuHeight: UNIFIED_BAR_HEIGHT,
  gapsY: 184,
  gapsHeight: UNIFIED_BAR_HEIGHT,
  simY: 220,
  simHeight: 78,
  dutyY: 304,
  dutyHeight: UNIFIED_BAR_HEIGHT,
  rulerY: 331,
  height: 365,
  leftGutter: 104,
  rightGutter: 24,
} as const;

/** A gap narrower than this is counted by the analyzer, not drawn: at this zoom
 * one pixel is tens of microseconds and drawing every gap would turn the lane
 * into a solid band. */
const MINIMUM_GAP_PX = 1.2;
/** Timing-predict bars use a fixed visual height; parallel row count is shown
 * by vertical placement, never by stretching one bar taller than another. */
const TIMING_ROW_GAP = 4;
/** Roughly one monospace character at the lane's font size. */
const LABEL_CHARACTER_PX = 4.6;
const LABEL_MINIMUM_WIDTH_PX = 48;
const CLICK_TOLERANCE_PX = 4;

export default function IterationTimelineCanvas({
  scene,
  host,
  referenceDeviceId,
  selectedTrace,
  ariaLabel,
  onStep,
  onSelectTrace,
  onPlotWidth,
  onViewport,
}: {
  scene: ContinuousScene;
  host: HostLaneCensus | null;
  referenceDeviceId: number;
  selectedTrace: TimelineTrace | null;
  ariaLabel: string;
  onStep: (delta: number) => void;
  onSelectTrace: (trace: TimelineTrace | null) => void;
  /** The drawn plot width, which is what turns the axis span into the "µs per
   * pixel" the card reports. Only the canvas knows it, and it changes with the
   * container rather than with the data. */
  onPlotWidth: (widthPx: number) => void;
  /** The window the lanes are currently drawn for, for the same reason: the
   * card's own caption states a resolution, and after a zoom that resolution is
   * the window's, not the whole axis's. */
  onViewport: (viewport: AxisSpan) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerDownRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(
    null,
  );
  const [width, setWidth] = useState(0);
  // Every lane shares one window: they are one figure read down a column, and a
  // host launch beside the kernel it launched is the whole point of the stack.
  const zoom = useAxisZoom(
    sceneDomain(scene),
    plotInsets(LAYOUT.leftGutter, LAYOUT.rightGutter, width),
  );
  const { surfaceRef, viewport } = zoom;

  // The canvas itself is measured and gestured on, rather than the padded box
  // around it: its rect is the one the drawing is scaled to, so an anchor read
  // against anything else would zoom around the wrong millisecond.
  const attachCanvas = useCallback(
    (element: HTMLCanvasElement | null) => {
      canvasRef.current = element;
      surfaceRef(element);
    },
    [surfaceRef],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const measure = () => setWidth(canvas.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => onViewport(viewport), [viewport, onViewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || width <= 0) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(LAYOUT.height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, LAYOUT.height);
    onPlotWidth(
      drawScene(context, {
        width,
        scene,
        host,
        referenceDeviceId,
        selectedTrace,
        viewport,
      }),
    );
  }, [width, scene, host, referenceDeviceId, selectedTrace, viewport, onPlotWidth]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button === 0) {
        pointerDownRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
        };
      }
      zoom.surfaceProps.onPointerDown(event);
    },
    [zoom.surfaceProps],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const pointerDown = pointerDownRef.current;
      pointerDownRef.current = null;
      zoom.surfaceProps.onPointerUp(event);
      if (
        pointerDown === null ||
        pointerDown.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - pointerDown.clientX, event.clientY - pointerDown.clientY) >
          CLICK_TOLERANCE_PX
      ) {
        return;
      }
      onSelectTrace(hitTestTimeline(event, canvasRef.current, width, viewport, scene, host));
    },
    [host, onSelectTrace, scene, viewport, width, zoom.surfaceProps],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      pointerDownRef.current = null;
      zoom.surfaceProps.onPointerCancel(event);
    },
    [zoom.surfaceProps],
  );

  return (
    <Box sx={{ width: '100%', px: 2 }}>
      <Box
        component="canvas"
        ref={attachCanvas}
        role="application"
        tabIndex={0}
        aria-label={ariaLabel}
        {...zoom.surfaceProps}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={(event) => {
          // Shifted arrows keep the iteration stepping the picker also offers;
          // the bare arrows now pan, because a zoomed axis needs them more than
          // a second copy of a control that is already on the card.
          const steps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };
          const delta = steps[event.key];
          if (event.shiftKey && delta !== undefined) {
            event.preventDefault();
            onStep(delta);
            return;
          }
          zoom.surfaceProps.onKeyDown(event);
        }}
        sx={{
          width: '100%',
          height: LAYOUT.height,
          display: 'block',
          outline: 'none',
          touchAction: 'pan-y',
          userSelect: 'none',
          cursor: zoom.isPanning ? 'grabbing' : 'grab',
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: '-2px' },
        }}
      />
      <Box sx={{ pt: '4px' }}>
        <AxisZoomFootnote
          range={axisWindowNote(scene, viewport)}
          isFull={zoom.isFull}
          onReset={zoom.reset}
        />
      </Box>
    </Box>
  );
}

interface DrawOptions {
  readonly width: number;
  readonly scene: ContinuousScene;
  readonly host: HostLaneCensus | null;
  readonly referenceDeviceId: number;
  readonly selectedTrace: TimelineTrace | null;
  /** The stretch of the shared axis on screen. Every lane is projected through
   * it, so one gesture moves the whole stack and the rows stay comparable. */
  readonly viewport: AxisSpan;
}

type Projection = (valueMs: number) => number;

/** Draws the scene and returns the plot width it used. */
function drawScene(context: CanvasRenderingContext2D, options: DrawOptions): number {
  const { width, scene, viewport } = options;
  const plotWidth = Math.max(1, width - LAYOUT.leftGutter - LAYOUT.rightGutter);
  const domainMs = Math.max(viewport.end - viewport.start, Number.EPSILON);
  const toX: Projection = (valueMs) =>
    LAYOUT.leftGutter + ((valueMs - viewport.start) / domainMs) * plotWidth;

  // Zoomed in, most of the capture lies outside the plot; without this the
  // lanes would run straight over the labels in either gutter.
  context.save();
  context.beginPath();
  context.rect(LAYOUT.leftGutter, 0, plotWidth, LAYOUT.height);
  context.clip();

  const selected = scene.lanes[scene.selectedIndex];
  const next = scene.lanes[scene.selectedIndex + 1];
  // The selected iteration owns the axis from its anchor to the next anchor.
  const ownedFrom = toX(selected.offsetMs);
  const ownedTo = toX(next === undefined ? selected.kernelEndMs : next.offsetMs);
  drawSectionBackdrops(context, plotWidth);
  context.fillStyle = withAlpha(tokens.teal, 0.05);
  context.fillRect(
    ownedFrom,
    LAYOUT.schedulerY - 4,
    Math.max(1, ownedTo - ownedFrom),
    LAYOUT.dutyY + LAYOUT.dutyHeight - LAYOUT.schedulerY + 8,
  );

  drawHostLanes(context, options, toX, plotWidth);
  for (const lane of scene.lanes) drawDeviceLanes(context, options, lane, toX);
  drawKernelSimulationLinks(context, options, toX);
  for (const lane of scene.lanes) drawDeviceLabels(context, options, lane, toX, width);
  drawInterIterationGaps(context, scene, toX);
  drawIterationMarks(context, scene, toX);
  context.restore();

  drawRuler(context, viewport, toX, width);
  drawLaneLabels(context, options);
  return plotWidth;
}

/**
 * Give the timeline three quiet visual chapters. The operation colours carry
 * identity, while these low-alpha fills carry ownership: host submission,
 * measured GPU work, and modelled work. Keeping the fills behind every bar
 * prevents the section cue from competing with the measured/modelled pairing.
 */
function drawSectionBackdrops(context: CanvasRenderingContext2D, plotWidth: number): void {
  const sections = [
    {
      top: LAYOUT.schedulerY - 10,
      bottom: LAYOUT.gpuY - 8,
      color: tokens.sectionStructure,
    },
    {
      top: LAYOUT.gpuY - 8,
      bottom: LAYOUT.simY - 10,
      color: tokens.teal,
    },
    {
      top: LAYOUT.simY - 10,
      bottom: LAYOUT.dutyY + LAYOUT.dutyHeight + 8,
      color: tokens.violet,
    },
  ] as const;

  for (const section of sections) {
    context.fillStyle = withAlpha(section.color, 0.055);
    context.fillRect(LAYOUT.leftGutter, section.top, plotWidth, section.bottom - section.top);
    context.strokeStyle = withAlpha(section.color, 0.28);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(LAYOUT.leftGutter, section.top);
    context.lineTo(LAYOUT.leftGutter + plotWidth, section.top);
    context.stroke();
  }
}

function laneText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  bold = false,
  align: CanvasTextAlign = 'left',
): void {
  context.fillStyle = color;
  context.font = `${bold ? '600 ' : ''}9px ${tokens.mono}`;
  context.textAlign = align;
  context.fillText(text, x, y);
}

function drawHostLanes(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  toX: Projection,
  plotWidth: number,
): void {
  // A faint band per lane, so a lane that is empty over this window still reads
  // as a lane: "the scheduler did nothing here" is an answer, not a missing row.
  const bands: readonly (readonly [number, number])[] = [
    [LAYOUT.schedulerY, LAYOUT.schedulerHeight],
    [LAYOUT.nvtxY, HOST_NVTX_DEPTHS * (LAYOUT.nvtxHeight + LAYOUT.nvtxGap) - LAYOUT.nvtxGap],
    [LAYOUT.apiY, LAYOUT.apiHeight],
    [LAYOUT.helperY, LAYOUT.helperHeight],
  ];
  context.fillStyle = laneBandColor;
  for (const [top, height] of bands) context.fillRect(LAYOUT.leftGutter, top, plotWidth, height);

  if (options.host === null) return;

  // A range that opened in an earlier iteration is carried into this one whole,
  // so rows are clipped to the plot rather than dropped — and clipped rather
  // than left to run over the lane labels in the gutter.
  context.save();
  context.beginPath();
  context.rect(
    LAYOUT.leftGutter,
    LAYOUT.schedulerY - 3,
    plotWidth,
    LAYOUT.gpuY - 8 - (LAYOUT.schedulerY - 3),
  );
  context.clip();
  for (const lane of options.host.lanes) {
    if (lane.kind === 'nvtx') drawNvtxLane(context, lane, toX, options.width);
    else drawApiLane(context, options, lane, toX);
  }
  context.restore();

  context.strokeStyle = withAlpha(tokens.hair, 0.9);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(LAYOUT.leftGutter, LAYOUT.gpuY - 7);
  context.lineTo(options.width - LAYOUT.rightGutter, LAYOUT.gpuY - 7);
  context.stroke();
}

function drawNvtxLane(
  context: CanvasRenderingContext2D,
  lane: HostLaneGroup,
  toX: Projection,
  width: number,
): void {
  const isScheduler = lane.key === 'scheduler';
  const top = isScheduler ? LAYOUT.schedulerY : LAYOUT.nvtxY;
  const rowHeight = isScheduler ? LAYOUT.schedulerHeight : LAYOUT.nvtxHeight;
  for (const row of lane.rows) {
    const x = toX(row.startMs);
    const barWidth = Math.max(0.8, toX(row.endMs) - x);
    const y = isScheduler ? top : top + row.depth * (rowHeight + LAYOUT.nvtxGap);
    context.fillStyle = nvtxDepthColor(row.depth);
    context.fillRect(x, y, barWidth, rowHeight);
    // Clamp the caption into the visible part so a clipped bar still reads.
    const textX = Math.max(x, LAYOUT.leftGutter) + 3;
    const room = Math.min(x + barWidth, width - LAYOUT.rightGutter) - textX;
    if (room >= row.label.length * LABEL_CHARACTER_PX) {
      laneText(context, row.label, textX, y + rowHeight - 1.5, tokens.ink);
    }
  }
}

function drawApiLane(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  lane: HostLaneGroup,
  toX: Projection,
): void {
  const isHelper = lane.key === 'helperApi';
  const top = isHelper ? LAYOUT.helperY : LAYOUT.apiY;
  const rowHeight = isHelper ? LAYOUT.helperHeight : LAYOUT.apiHeight;
  const selectedIds = connectedTraceIds(options.selectedTrace, options.scene, options.host);
  for (const row of lane.rows) {
    const x = toX(row.startMs);
    const barWidth = Math.max(0.6, toX(row.endMs) - x);
    const isSelected = selectedIds.has(row.id);
    context.globalAlpha = 1;
    context.fillStyle = apiClassColor(row.apiClassIndex ?? 0);
    context.fillRect(x, top, barWidth, rowHeight);
    if (isSelected) {
      context.strokeStyle = tokens.ink;
      context.lineWidth = 1.4;
      context.strokeRect(x, top, barWidth, rowHeight);
    }
    context.globalAlpha = 1;
    drawBarLabel(context, row.label, x, toX(row.endMs), top, rowHeight, isSelected, options.width);
  }
}

function drawDeviceLanes(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  lane: IterationLane,
  toX: Projection,
): void {
  // Selection is additive emphasis only. The operation palette remains the
  // primary encoding, so choosing a kernel or operation must not wash the
  // other measured/modelled bars into a gray shadow.
  const selectedIds = connectedTraceIds(options.selectedTrace, options.scene, options.host);

  for (const bar of lane.measured) {
    const x = toX(bar.startMs);
    const isConnected = selectedIds.has(bar.id);
    context.globalAlpha = 1;
    context.fillStyle = bar.color;
    context.fillRect(x, LAYOUT.gpuY, Math.max(0.7, toX(bar.endMs) - x), LAYOUT.gpuHeight);
    if (isConnected) {
      context.strokeStyle = isConnected
        ? bar.id === options.selectedTrace?.id
          ? tokens.ink
          : tokens.teal
        : bar.color;
      context.lineWidth = isConnected && bar.id === options.selectedTrace?.id ? 1.4 : 1;
      context.strokeRect(x, LAYOUT.gpuY, Math.max(0.7, toX(bar.endMs) - x), LAYOUT.gpuHeight);
    }
  }
  context.globalAlpha = 1;

  context.fillStyle = withAlpha(tokens.terra, 0.62);
  for (const gap of lane.gaps) {
    const x = toX(gap.startMs);
    const gapWidth = toX(gap.endMs) - x;
    if (gapWidth < MINIMUM_GAP_PX) continue;
    context.fillRect(x, LAYOUT.gapsY, gapWidth, LAYOUT.gapsHeight);
  }

  // Concurrent branches of a Max node share a span, so each gets a sub-row and
  // the lane keeps its height: stacking them would make the model look taller
  // where it is merely parallel.
  const timingLayout = simulatedTimingLayout(lane.simulatedRowCount);
  for (const bar of lane.simulated) {
    const x = toX(bar.startMs);
    const isConnected = selectedIds.has(bar.id);
    context.globalAlpha = 1;
    context.fillStyle = bar.color;
    context.fillRect(
      x,
      timingLayout.top + bar.row * (UNIFIED_BAR_HEIGHT + TIMING_ROW_GAP),
      Math.max(0.7, toX(bar.endMs) - x),
      UNIFIED_BAR_HEIGHT,
    );
    if (isConnected) {
      context.strokeStyle = isConnected
        ? bar.id === options.selectedTrace?.id
          ? tokens.ink
          : tokens.teal
        : bar.color;
      context.lineWidth = isConnected && bar.id === options.selectedTrace?.id ? 1.4 : 1;
      context.strokeRect(
        x,
        timingLayout.top + bar.row * (UNIFIED_BAR_HEIGHT + TIMING_ROW_GAP),
        Math.max(0.7, toX(bar.endMs) - x),
        UNIFIED_BAR_HEIGHT,
      );
    }
  }
  context.globalAlpha = 1;

  if (lane.simulatedGpuCycleEndMs !== null) {
    const from = toX(lane.offsetMs);
    const dutyWidth = Math.max(1, toX(lane.simulatedGpuCycleEndMs) - from);
    context.fillStyle = withAlpha(tokens.violet, 0.14);
    context.fillRect(from, LAYOUT.dutyY, dutyWidth, LAYOUT.dutyHeight);
    context.strokeStyle = tokens.violet;
    context.lineWidth = 1.1;
    context.strokeRect(from, LAYOUT.dutyY, dutyWidth, LAYOUT.dutyHeight);
  }
}

function drawKernelSimulationLinks(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  toX: Projection,
): void {
  if (options.selectedTrace === null) return;
  const connections = traceConnections(options.selectedTrace, options.scene, options.host);
  if (connections.length === 0) return;

  context.save();
  context.strokeStyle = withAlpha(tokens.teal, 0.72);
  context.lineWidth = 1;
  context.setLineDash([3, 3]);
  for (const connection of connections) {
    const kernelX = toX((connection.kernel.startMs + connection.kernel.endMs) / 2);
    if (connection.simulation !== null) {
      const simulationX = toX((connection.simulation.startMs + connection.simulation.endMs) / 2);
      const simulationRowCount =
        options.scene.lanes.find((lane) => lane.iterationId === connection.simulation?.iterationId)
          ?.simulatedRowCount ?? 1;
      const timingLayout = simulatedTimingLayout(simulationRowCount);
      const simulationY =
        timingLayout.top +
        connection.simulation.row * (UNIFIED_BAR_HEIGHT + TIMING_ROW_GAP) +
        UNIFIED_BAR_HEIGHT / 2;
      // The connector uses the lane centres. The selected item's exact row is
      // still visible through the highlighted bars; keeping the bridge centred
      // avoids a bundle of repeated slots becoming unreadable at high zoom.
      context.beginPath();
      context.moveTo(kernelX, LAYOUT.gpuY + LAYOUT.gpuHeight);
      context.bezierCurveTo(
        kernelX,
        LAYOUT.gapsY + LAYOUT.gapsHeight,
        simulationX,
        LAYOUT.simY - 4,
        simulationX,
        simulationY,
      );
      context.stroke();
    }

    if (connection.api !== null) {
      const apiX = toX((connection.api.startMs + connection.api.endMs) / 2);
      const apiY = apiLaneCenterY(connection.api.laneKey);
      context.beginPath();
      context.moveTo(apiX, apiY);
      context.bezierCurveTo(apiX, LAYOUT.gpuY - 8, kernelX, LAYOUT.gpuY - 4, kernelX, LAYOUT.gpuY);
      context.stroke();
    }
  }
  context.restore();
}

function apiLaneCenterY(laneKey: string): number {
  return laneKey === 'helperApi'
    ? LAYOUT.helperY + LAYOUT.helperHeight / 2
    : LAYOUT.apiY + LAYOUT.apiHeight / 2;
}

function drawDeviceLabels(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  lane: IterationLane,
  toX: Projection,
  width: number,
): void {
  const selectedIds = connectedTraceIds(options.selectedTrace, options.scene, options.host);
  for (const bar of lane.measured) {
    drawBarLabel(
      context,
      bar.label,
      toX(bar.startMs),
      toX(bar.endMs),
      LAYOUT.gpuY,
      LAYOUT.gpuHeight,
      selectedIds.has(bar.id),
      width,
    );
  }
  const timingLayout = simulatedTimingLayout(lane.simulatedRowCount);
  for (const bar of lane.simulated) {
    drawBarLabel(
      context,
      bar.label,
      toX(bar.startMs),
      toX(bar.endMs),
      timingLayout.top + bar.row * (UNIFIED_BAR_HEIGHT + TIMING_ROW_GAP),
      UNIFIED_BAR_HEIGHT,
      selectedIds.has(bar.id),
      width,
    );
  }
}

function simulatedTimingLayout(simulatedRowCount: number): {
  readonly top: number;
} {
  const rowCount = Math.max(1, simulatedRowCount);
  const stackHeight = rowCount * UNIFIED_BAR_HEIGHT + Math.max(0, rowCount - 1) * TIMING_ROW_GAP;
  return {
    top: LAYOUT.simY + Math.max(0, (LAYOUT.simHeight - stackHeight) / 2),
  };
}

function drawBarLabel(
  context: CanvasRenderingContext2D,
  label: string,
  startX: number,
  endX: number,
  top: number,
  height: number,
  selected: boolean,
  width: number,
): void {
  const visibleStart = Math.max(startX, LAYOUT.leftGutter);
  const visibleEnd = Math.min(endX, width - LAYOUT.rightGutter);
  const room = visibleEnd - visibleStart - 6;
  if (room < LABEL_MINIMUM_WIDTH_PX || height < 8) return;
  const text = fitCanvasLabel(label, room);
  if (text.length === 0) return;
  laneText(context, text, visibleStart + 3, top + height - 4, tokens.ink, selected);
}

function fitCanvasLabel(label: string, width: number): string {
  const maximumCharacters = Math.floor(width / LABEL_CHARACTER_PX);
  if (maximumCharacters <= 0) return '';
  if (label.length <= maximumCharacters) return label;
  if (maximumCharacters <= 3) return '';
  return `${label.slice(0, maximumCharacters - 3)}...`;
}

function drawInterIterationGaps(
  context: CanvasRenderingContext2D,
  scene: ContinuousScene,
  toX: Projection,
): void {
  for (const gap of scene.interIterationGaps) {
    const x = toX(gap.startMs);
    const gapWidth = Math.max(1.2, toX(gap.endMs) - x);
    context.fillStyle = withAlpha(tokens.gold, 0.85);
    context.fillRect(x, LAYOUT.gapsY - 2, gapWidth, LAYOUT.gapsHeight + 4);
    laneText(
      context,
      `between iterations ${gapCaption(gap.microseconds)}`,
      x + gapWidth / 2,
      LAYOUT.gapsY + 21,
      tokens.gold,
      false,
      'center',
    );
  }
}

/** The lane captions are drawn, not laid out in the DOM, so they carry their
 * own unit switch. It is the same rule `fmtMs` applies — microseconds under a
 * millisecond — but a canvas caption has no use for that function's `—`
 * fallback, since a drawn gap is finite by construction. */
/** A ruler label carries the digits its window earns: whole milliseconds across
 * a capture, fractions of one once the window is a few of them wide. Trailing
 * zeros are dropped rather than padded, so the row of ticks stays a scale
 * instead of a column of identical numbers. */
function rulerTickLabel(valueMs: number, viewport: AxisSpan): string {
  const windowMs = viewport.end - viewport.start;
  const digits = windowMs >= 20 ? 0 : windowMs >= 2 ? 1 : windowMs >= 0.2 ? 2 : 3;
  return `${valueMs.toLocaleString('en-US', { maximumFractionDigits: digits })} ms`;
}

function gapCaption(microseconds: number): string {
  return microseconds >= 1000
    ? `${(microseconds / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} ms`
    : `${microseconds.toLocaleString('en-US', { maximumFractionDigits: 0 })} µs`;
}

function drawIterationMarks(
  context: CanvasRenderingContext2D,
  scene: ContinuousScene,
  toX: Projection,
): void {
  scene.lanes.forEach((lane, index) => {
    const x = toX(lane.offsetMs);
    const isSelected = index === scene.selectedIndex;
    context.strokeStyle = withAlpha(tokens.teal, isSelected ? 1 : 0.45);
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(x, LAYOUT.labelY + 3);
    context.lineTo(x, LAYOUT.rulerY);
    context.stroke();
    laneText(
      context,
      `${lane.role} · ${lane.iterationId} · ${lane.iterationType}`,
      x + 4,
      LAYOUT.labelY,
      isSelected ? tokens.teal : tokens.sub2,
    );
  });
}

/** The ruler is recomputed from the window rather than scaled with it: a zoomed
 * axis carrying the ticks of the whole capture would be measuring something
 * that is no longer drawn. */
function drawRuler(
  context: CanvasRenderingContext2D,
  viewport: AxisSpan,
  toX: Projection,
  width: number,
): void {
  context.strokeStyle = tokens.hair;
  context.lineWidth = 1;
  for (const tick of niceTicks(viewport.start, viewport.end, 10)) {
    // `Math.ceil` on a small negative low yields negative zero, which prints as
    // "-0 ms" — a tick that reads like a direction rather than an origin.
    const value = tick === 0 ? 0 : tick;
    const x = toX(value);
    context.beginPath();
    context.moveTo(x, LAYOUT.rulerY - 4);
    context.lineTo(x, LAYOUT.rulerY);
    context.stroke();
    laneText(
      context,
      rulerTickLabel(value, viewport),
      x,
      LAYOUT.rulerY + 12,
      tokens.sub2,
      false,
      'center',
    );
  }
  context.beginPath();
  context.moveTo(LAYOUT.leftGutter, LAYOUT.rulerY);
  context.lineTo(width - LAYOUT.rightGutter, LAYOUT.rulerY);
  context.stroke();
}

function drawLaneLabels(context: CanvasRenderingContext2D, options: DrawOptions): void {
  const hostLabel = (index: number, fallback: string): string =>
    options.host?.lanes[index]?.label ?? fallback;
  laneText(context, 'HOST / CPU', 0, LAYOUT.schedulerY - 1, tokens.sectionStructure, true);
  laneText(context, 'MEASURED / GPU', 0, LAYOUT.gpuY - 1, tokens.teal, true);
  laneText(context, 'MODELLED / SIM', 0, LAYOUT.simY - 1, tokens.violet, true);
  const rows: readonly (readonly [string, number, number, boolean])[] = [
    [hostLabel(0, 'scheduler'), 0, LAYOUT.schedulerY + 6, true],
    [hostLabel(1, `host/${options.referenceDeviceId}`), 0, LAYOUT.nvtxY + 6, true],
    [hostLabel(2, '└ cuda api'), 12, LAYOUT.apiY + 9, false],
    [hostLabel(3, '└ helpers'), 12, LAYOUT.helperY + 6, false],
    [`gpu/${options.referenceDeviceId}`, 0, LAYOUT.gpuY + 16, true],
    ['└ gaps', 12, LAYOUT.gapsY + 7, false],
    ['sim', 0, LAYOUT.simY + 16, true],
    ['└ × duty', 12, LAYOUT.dutyY + 9, false],
  ];
  for (const [text, x, y, bold] of rows) {
    laneText(context, text, x, y, bold ? tokens.ink : tokens.sub, bold);
  }
}

/** Hit testing follows the same projected rectangles the canvas draws. It is
 * intentionally separate from the zoom gesture: a short pointer gesture is a
 * selection, while a moved pointer remains a pan. */
function hitTestTimeline(
  event: ReactPointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  width: number,
  viewport: AxisSpan,
  scene: ContinuousScene,
  host: HostLaneCensus | null,
): TimelineTrace | null {
  if (canvas === null || width <= 0) return null;
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const plotWidth = Math.max(1, width - LAYOUT.leftGutter - LAYOUT.rightGutter);
  if (x < LAYOUT.leftGutter || x > width - LAYOUT.rightGutter) return null;
  const domainMs = Math.max(viewport.end - viewport.start, Number.EPSILON);
  const valueMs = viewport.start + ((x - LAYOUT.leftGutter) / plotWidth) * domainMs;

  for (const { laneKey, row } of [...apiRows(host)].reverse()) {
    const top = laneKey === 'helperApi' ? LAYOUT.helperY : LAYOUT.apiY;
    const rowHeight = laneKey === 'helperApi' ? LAYOUT.helperHeight : LAYOUT.apiHeight;
    if (
      y >= top &&
      y <= top + rowHeight &&
      projectedBarContains(x, valueMs, row, plotWidth, viewport, width)
    ) {
      return traceFromApi(row, laneKey);
    }
  }

  if (y >= LAYOUT.gpuY && y <= LAYOUT.gpuY + LAYOUT.gpuHeight) {
    for (const lane of [...scene.lanes].reverse()) {
      for (const bar of [...lane.measured].reverse()) {
        if (projectedBarContains(x, valueMs, bar, plotWidth, viewport, width)) {
          return traceFromBar(bar, 'kernel');
        }
      }
    }
  }

  if (y >= LAYOUT.simY && y <= LAYOUT.simY + LAYOUT.simHeight) {
    for (const lane of [...scene.lanes].reverse()) {
      const timingLayout = simulatedTimingLayout(lane.simulatedRowCount);
      for (const bar of [...lane.simulated].reverse()) {
        const rowTop = timingLayout.top + bar.row * (UNIFIED_BAR_HEIGHT + TIMING_ROW_GAP);
        if (
          y >= rowTop &&
          y <= rowTop + UNIFIED_BAR_HEIGHT &&
          projectedBarContains(x, valueMs, bar, plotWidth, viewport, width)
        ) {
          return traceFromBar(bar, 'simulation');
        }
      }
    }
  }
  return null;
}

function projectedBarContains(
  x: number,
  valueMs: number,
  bar: { readonly startMs: number; readonly endMs: number },
  plotWidth: number,
  viewport: AxisSpan,
  width: number,
): boolean {
  const domainMs = Math.max(viewport.end - viewport.start, Number.EPSILON);
  const project = (value: number) =>
    LAYOUT.leftGutter + ((value - viewport.start) / domainMs) * plotWidth;
  const startX = Math.max(LAYOUT.leftGutter, project(bar.startMs));
  const endX = Math.min(width - LAYOUT.rightGutter, Math.max(startX + 0.7, project(bar.endMs)));
  return x >= startX && x <= endX && valueMs >= bar.startMs && valueMs <= bar.endMs;
}
