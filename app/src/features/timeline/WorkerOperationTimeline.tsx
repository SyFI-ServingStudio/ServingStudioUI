import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';

import {
  useActiveWorkerOperationSeekState,
  useActiveWorkerOperationState,
} from '../../application/WorkerTreeProvider';
import { OPERATION_VIEWPORT_SIZE } from '../../application/workerOperationBuffer';
import SurfaceCard from '../../components/SurfaceCard';
import { workerOperationLabel, type OperationSummary } from '../../domain/workerOperation';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import {
  hitTestOperation,
  OPERATION_DRAG_THRESHOLD_PX,
  OPERATION_TRACK_HEIGHT_PX,
  operationBarGeometry,
  operationDurationScaleMs,
  operationLaneColor,
  operationMaximumDurationMs,
  type TimelineOperationEntry,
} from './workerOperationTimelineModel';

const MAX_VISIBLE_COLOR_KEYS = 8;
const DURATION_SCALE_ANIMATION_MS = 320;
const EMPTY_OPERATIONS: readonly OperationSummary[] = Object.freeze([]);

interface DragGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startViewportOffset: number;
  readonly visibleCount: number;
  appliedOperations: number;
  didDrag: boolean;
}

const sameOperation = (left: OperationSummary, right: OperationSummary): boolean =>
  left.ref.iterId === right.ref.iterId &&
  left.ref.batchId === right.ref.batchId &&
  left.ref.operationId === right.ref.operationId;

function operationAriaLabel(operation: OperationSummary, identityRole: 'slot' | 'batch'): string {
  return `iter ${operation.ref.iterId}, ${identityRole} ${operation.ref.batchId}, ${workerOperationLabel(operation)}, ${operation.startMs.toFixed(3)} to ${operation.endMs.toFixed(3)} milliseconds`;
}

function durationTickLabel(durationMs: number): string {
  if (durationMs >= 100) return `${durationMs.toFixed(0)} ms`;
  if (durationMs >= 10) return `${durationMs.toFixed(1)} ms`;
  return `${durationMs.toFixed(2)} ms`;
}

function requestScaleFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelScaleFrame(frameId: number): void {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frameId);
  else window.clearTimeout(frameId);
}

export default function WorkerOperationTimeline() {
  const state = useActiveWorkerOperationState();
  const seek = useActiveWorkerOperationSeekState();
  const selectOperation = useViz((viz) => viz.selectOperation);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragGesture | null>(null);
  const durationScaleWorkerRef = useRef<string | null>(null);
  const renderedDurationScaleRef = useRef({ p95Ms: 1, maximumMs: 1 });
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const [trackWidth, setTrackWidth] = useState(1000);
  const [durationScaleMs, setDurationScaleMs] = useState(1);
  const [maximumDurationMs, setMaximumDurationMs] = useState(1);
  const [hoveredOperation, setHoveredOperation] = useState<OperationSummary | null>(null);
  const operations = state.status === 'ready' ? state.operations : EMPTY_OPERATIONS;
  const selected = state.status === 'ready' ? state.selected : null;
  const residentOperations =
    state.status === 'ready' ? state.viewport.buffer.operations : EMPTY_OPERATIONS;
  const targetDurationScaleMs = useMemo(
    () => operationDurationScaleMs(residentOperations),
    [residentOperations],
  );
  const targetMaximumDurationMs = useMemo(
    () => operationMaximumDurationMs(residentOperations),
    [residentOperations],
  );
  const durationScaleWorkerIdentity =
    state.status === 'ready'
      ? `${state.worker.key}:${state.viewport.buffer.total}:${state.viewport.buffer.span?.startMs ?? 'na'}:${state.viewport.buffer.span?.endMs ?? 'na'}`
      : null;
  const entries = useMemo<readonly TimelineOperationEntry[]>(
    () => operations.map((operation) => ({ key: String(operation.ordinal), operation })),
    [operations],
  );
  const selectedIndex =
    selected === null
      ? -1
      : operations.findIndex((operation) => sameOperation(operation, selected));
  const hoveredIndex =
    hoveredOperation === null
      ? -1
      : operations.findIndex((operation) => sameOperation(operation, hoveredOperation));
  const identityRole = state.status === 'ready' ? state.viewport.buffer.batchRole : 'batch';
  const visibleColorKeys = useMemo(
    () =>
      [...new Set(operations.map((operation) => operation.ref.batchId))].sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      ),
    [operations],
  );

  useEffect(() => {
    if (state.status !== 'ready' || durationScaleWorkerIdentity === null) return;
    const isNewWorker = durationScaleWorkerRef.current !== durationScaleWorkerIdentity;
    durationScaleWorkerRef.current = durationScaleWorkerIdentity;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (isNewWorker || reducedMotion) {
      renderedDurationScaleRef.current = {
        p95Ms: targetDurationScaleMs,
        maximumMs: targetMaximumDurationMs,
      };
      setDurationScaleMs(targetDurationScaleMs);
      setMaximumDurationMs(targetMaximumDurationMs);
      return;
    }

    const startScale = renderedDurationScaleRef.current;
    if (
      Math.abs(startScale.p95Ms - targetDurationScaleMs) <= Number.EPSILON &&
      Math.abs(startScale.maximumMs - targetMaximumDurationMs) <= Number.EPSILON
    ) {
      return;
    }
    const startedAt = performance.now();
    let frameId = 0;
    const animateScale = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DURATION_SCALE_ANIMATION_MS);
      const easedProgress = 1 - (1 - progress) ** 3;
      const nextP95Ms =
        startScale.p95Ms + (targetDurationScaleMs - startScale.p95Ms) * easedProgress;
      const nextMaximumMs =
        startScale.maximumMs + (targetMaximumDurationMs - startScale.maximumMs) * easedProgress;
      renderedDurationScaleRef.current = { p95Ms: nextP95Ms, maximumMs: nextMaximumMs };
      setDurationScaleMs(nextP95Ms);
      setMaximumDurationMs(nextMaximumMs);
      if (progress < 1) frameId = requestScaleFrame(animateScale);
    };
    frameId = requestScaleFrame(animateScale);
    return () => cancelScaleFrame(frameId);
  }, [durationScaleWorkerIdentity, state.status, targetDurationScaleMs, targetMaximumDurationMs]);

  useEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    const updateWidth = () => setTrackWidth(Math.max(1, track.getBoundingClientRect().width));
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, [state.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || state.status !== 'ready') return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(trackWidth * pixelRatio);
    canvas.height = Math.round(OPERATION_TRACK_HEIGHT_PX * pixelRatio);
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, trackWidth, OPERATION_TRACK_HEIGHT_PX);
    operations.forEach((operation, index) => {
      const operationDurationMs = operation.endMs - operation.startMs;
      const geometry = operationBarGeometry(
        index,
        operations.length,
        trackWidth,
        operationDurationMs,
        durationScaleMs,
        pixelRatio,
        OPERATION_TRACK_HEIGHT_PX,
        dragDeltaX,
        Math.abs(operationDurationMs - targetMaximumDurationMs) <= Number.EPSILON,
      );
      if (index === hoveredIndex) {
        context.fillStyle = 'rgba(42,38,34,.065)';
        context.globalAlpha = 1;
        context.fillRect(
          geometry.cellX + 1,
          1,
          Math.max(0, geometry.cellWidth - 2),
          OPERATION_TRACK_HEIGHT_PX - 2,
        );
      }
      context.fillStyle = operationLaneColor(operation.ref.batchId);
      context.globalAlpha = index === selectedIndex || index === hoveredIndex ? 0.98 : 0.72;
      context.fillRect(geometry.barX, geometry.barY, geometry.barWidth, geometry.barHeight);
      if (index === selectedIndex) {
        context.globalAlpha = 1;
        context.strokeStyle = tokens.ink;
        context.lineWidth = 2;
        context.strokeRect(
          geometry.barX - 1,
          geometry.barY - 1,
          geometry.barWidth + 2,
          geometry.barHeight + 2,
        );
      } else if (index === hoveredIndex) {
        context.globalAlpha = 1;
        context.strokeStyle = tokens.teal;
        context.lineWidth = 1;
        context.strokeRect(
          geometry.barX - 0.5,
          geometry.barY - 0.5,
          geometry.barWidth + 1,
          geometry.barHeight + 1,
        );
      }
    });
    context.globalAlpha = 1;
  }, [
    dragDeltaX,
    durationScaleMs,
    hoveredIndex,
    operations,
    selectedIndex,
    state.status,
    targetMaximumDurationMs,
    trackWidth,
  ]);

  if (state.status === 'idle') return null;
  if (state.status !== 'ready') {
    return (
      <SurfaceCard
        accent={state.status === 'error' || state.status === 'failed' ? tokens.terra : tokens.gold}
        role={state.status === 'error' || state.status === 'failed' ? 'alert' : 'status'}
        sx={{ p: 2 }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Worker operations
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub }}>
          {state.status === 'loading' ? 'Loading operation buffer…' : state.reason}
        </Typography>
      </SurfaceCard>
    );
  }

  const hitAtClientX = (clientX: number) => {
    const bounds = trackRef.current?.getBoundingClientRect();
    return bounds === undefined
      ? null
      : (hitTestOperation(entries, clientX - bounds.left, bounds.width)?.operation ?? null);
  };
  const updateHoveredOperation = (clientX: number) => {
    const hit = hitAtClientX(clientX);
    setHoveredOperation((current) => {
      if (hit === null || current === null) return hit;
      return sameOperation(current, hit) ? current : hit;
    });
  };
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = dragRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragDeltaX(0);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.didDrag) return;
    if (!cancelled) {
      const hit = hitAtClientX(event.clientX);
      if (hit !== null) selectOperation(hit);
    }
  };
  const moveKeyboard = (direction: -1 | 1) => {
    if (operations.length === 0) return;
    const current = selectedIndex >= 0 ? selectedIndex : direction > 0 ? -1 : operations.length;
    const target = operations[Math.min(operations.length - 1, Math.max(0, current + direction))];
    if (target !== undefined) selectOperation(target);
  };
  return (
    <SurfaceCard accent={tokens.terra} sx={{ p: '15px 18px 18px' }}>
      <Stack direction="row" alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ gap: 1.25 }}>
        <Typography
          aria-live="polite"
          sx={{ minWidth: 0, fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}
        >
          Worker {state.worker.key} · operation selection
          <Box
            component="span"
            sx={{
              ml: 1.25,
              fontFamily: tokens.mono,
              fontSize: 10,
              fontWeight: 400,
              color: tokens.sub,
            }}
          >
            {selected === null
              ? `${state.viewport.buffer.total} exact operations`
              : `iter ${selected.ref.iterId} · ${identityRole} ${selected.ref.batchId} · ${workerOperationLabel(selected)}`}
          </Box>
        </Typography>
        <Stack
          direction="row"
          alignItems="center"
          useFlexGap
          sx={{ ml: 'auto', gap: 0.8 }}
          aria-label={`${state.viewport.buffer.batchRole} color legend`}
        >
          <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}>
            color →
          </Typography>
          {visibleColorKeys.slice(0, MAX_VISIBLE_COLOR_KEYS).map((identity) => (
            <Stack key={identity} direction="row" alignItems="center" sx={{ gap: 0.35 }}>
              <Box
                aria-hidden="true"
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: operationLaneColor(identity),
                }}
              />
              <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5 }}>{identity}</Typography>
            </Stack>
          ))}
          {visibleColorKeys.length > MAX_VISIBLE_COLOR_KEYS && (
            <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}>
              +{visibleColorKeys.length - MAX_VISIBLE_COLOR_KEYS}
            </Typography>
          )}
        </Stack>
      </Stack>

      {seek.status === 'loading' && (
        <Typography role="status" sx={{ mt: 1, fontFamily: tokens.mono, fontSize: 10 }}>
          Locating operations at {(seek.atMs / 1000).toFixed(3)}s…
        </Typography>
      )}
      {seek.status === 'error' && (
        <Typography role="alert" sx={{ mt: 1, fontFamily: tokens.mono, fontSize: 10 }}>
          {seek.reason}
        </Typography>
      )}
      <Stack direction="row" alignItems="stretch" sx={{ mt: 1.4 }}>
        <Box
          aria-label={`Duration axis from 0 to maximum ${durationTickLabel(maximumDurationMs)}, P95 ${durationTickLabel(durationScaleMs)}`}
          sx={{
            width: 76,
            height: OPERATION_TRACK_HEIGHT_PX,
            flex: '0 0 auto',
            position: 'relative',
            fontFamily: tokens.mono,
            color: tokens.sub,
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              top: 5,
              right: 0,
              bottom: 5,
              borderRight: `1px solid ${tokens.hair}`,
            }}
          />
          {[
            { key: 'max', label: `max ${durationTickLabel(maximumDurationMs)}`, top: 5 },
            {
              key: 'p95',
              label: `P95 ${durationTickLabel(durationScaleMs)}`,
              top: 'calc(20% + 3px)',
            },
            { key: 'zero', label: durationTickLabel(0), top: 'calc(100% - 5px)' },
          ].map((tick) => (
            <Box
              key={tick.key}
              sx={{
                position: 'absolute',
                insetInline: 0,
                top: tick.top,
                transform: tick.key === 'max' ? 'none' : 'translateY(-50%)',
              }}
            >
              <Typography
                component="span"
                sx={{
                  position: 'absolute',
                  right: 8,
                  fontFamily: 'inherit',
                  fontSize: 8.5,
                  lineHeight: 1,
                  color: tokens.sub2,
                  whiteSpace: 'nowrap',
                }}
              >
                {tick.label}
              </Typography>
              <Box
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  right: -1,
                  width: 5,
                  borderTop: `1px solid ${tokens.hair}`,
                }}
              />
            </Box>
          ))}
        </Box>
        <Tooltip
          arrow
          followCursor
          open={hoveredIndex >= 0 && hoveredOperation !== null}
          placement="top"
          enterDelay={80}
          onClose={() => setHoveredOperation(null)}
          title={
            hoveredIndex >= 0 && hoveredOperation !== null
              ? operationAriaLabel(hoveredOperation, identityRole)
              : ''
          }
        >
          <Box
            ref={trackRef}
            role="application"
            tabIndex={0}
            aria-label="Exact worker operations; drag horizontally to navigate"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startViewportOffset: state.viewport.viewportOffset,
                visibleCount: Math.max(1, operations.length),
                appliedOperations: 0,
                didDrag: false,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const gesture = dragRef.current;
              if (gesture !== null && gesture.pointerId === event.pointerId) {
                const deltaX = event.clientX - gesture.startX;
                const width = event.currentTarget.getBoundingClientRect().width;
                if (Math.abs(deltaX) >= OPERATION_DRAG_THRESHOLD_PX && width > 0) {
                  gesture.didDrag = true;
                  const requestedOffset =
                    gesture.startViewportOffset +
                    Math.round((-deltaX / width) * gesture.visibleCount);
                  const residentMinimum = state.viewport.buffer.offset;
                  const residentMaximum = Math.min(
                    state.viewport.buffer.total - 1,
                    state.viewport.buffer.offset + OPERATION_VIEWPORT_SIZE * 2,
                  );
                  const targetOffset = Math.min(
                    residentMaximum,
                    Math.max(residentMinimum, requestedOffset),
                  );
                  const appliedOffset = gesture.startViewportOffset + gesture.appliedOperations;
                  const operationDelta = targetOffset - appliedOffset;
                  if (operationDelta !== 0) {
                    gesture.appliedOperations += operationDelta;
                    state.navigate(operationDelta);
                  }
                  const appliedWidth = (gesture.appliedOperations / gesture.visibleCount) * width;
                  setDragDeltaX(deltaX + appliedWidth);
                }
              } else updateHoveredOperation(event.clientX);
            }}
            onPointerLeave={() => dragRef.current === null && setHoveredOperation(null)}
            onPointerUp={(event) => finishPointer(event, false)}
            onPointerCancel={(event) => finishPointer(event, true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                moveKeyboard(event.key === 'ArrowRight' ? 1 : -1);
              } else if ((event.key === 'Enter' || event.key === ' ') && selectedIndex < 0) {
                event.preventDefault();
                moveKeyboard(1);
              }
            }}
            sx={{
              height: OPERATION_TRACK_HEIGHT_PX,
              flex: 1,
              overflow: 'hidden',
              borderRadius: 1,
              background: tokens.tile2,
              cursor: dragRef.current === null ? 'pointer' : 'grabbing',
              touchAction: 'pan-y',
              userSelect: 'none',
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 2 },
            }}
          >
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              style={{ display: 'block', width: '100%', height: OPERATION_TRACK_HEIGHT_PX }}
            />
          </Box>
        </Tooltip>
      </Stack>
    </SurfaceCard>
  );
}
