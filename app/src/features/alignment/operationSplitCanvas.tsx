import { Box, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { tokens } from '../../theme';
import { fmtInt, fmtMs, fmtSignedMs, fmtSignedPct } from './format';
import { MODELLED_SLOT_FIELD } from './operationSplitCycles';
import {
  SPLIT_PLOT,
  type MeasuredGroup,
  type PlotGeometry,
  type SimulatedSlotRow,
  type StackSegment,
} from './operationSplitModel';
import { withAlpha, type OperationPalette } from './operationSplitPalette';

/**
 * The two stacks, their joins, and the difference they accumulate — one
 * canvas.
 *
 * One surface rather than three, because the three panels are one reading: a
 * segment, the ribbons leaving it and the step it causes must line up on the
 * same millisecond to the pixel, and separate charts sharing "the same" axis
 * drift apart the moment either one rounds its plot area differently.
 *
 * Nothing here computes a position. The geometry arrives already solved in a
 * fixed design space and is scaled to the card's width, which is also why the
 * proportions hold at any width instead of reflowing into a different figure.
 *
 * The canvas is not a keyboard target. Everything it selects — an operation —
 * is selectable from the rail beside it, where each operation is a real
 * button; a second focus stop over an unlabelled picture would add tab stops
 * without adding reach.
 */

const SEGMENT_LABEL_SIZE = 8;
const LANE_NAME_SIZE = 9.5;
const LANE_SUB_SIZE = 9;
const PHASE_MARK_SIZE = 8.5;
const STEP_LABEL_SIZE = 9;
const AXIS_LABEL_SIZE = 11.5;
const RIBBON_CONTROL_REACH = 22;
const TOOLTIP_WIDTH = 220;

interface HoveredSegment {
  readonly side: 'measured' | 'simulated';
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

export interface OperationSplitCanvasProps {
  readonly geometry: PlotGeometry;
  readonly groups: readonly MeasuredGroup[];
  readonly slots: readonly SimulatedSlotRow[];
  readonly measuredTotalMs: number;
  readonly simulatedTotalMs: number;
  readonly relativeDiffPct: number;
  readonly palette: OperationPalette;
  readonly selectedOperation: string | null;
  readonly onSelectOperation: (operation: string | null) => void;
  readonly ariaLabel: string;
}

const monoFont = (size: number): string => `${size}px ${tokens.mono}`;

function drawStack(
  context: CanvasRenderingContext2D,
  segments: readonly StackSegment[],
  palette: OperationPalette,
  selectedOperation: string | null,
): void {
  for (const segment of segments) {
    const chosen = selectedOperation !== null && segment.operation === selectedOperation;
    const dimmed = selectedOperation !== null && !chosen;
    context.globalAlpha = dimmed ? 0.2 : 0.95;
    context.fillStyle = palette.colorOf(segment.operation);
    context.fillRect(segment.x, segment.y, segment.width, segment.height);
    context.strokeStyle = chosen ? tokens.ink : tokens.tile;
    context.lineWidth = chosen ? 1.3 : 0.8;
    context.strokeRect(segment.x, segment.y, segment.width, segment.height);
    context.globalAlpha = 1;
    if (segment.label === 'none' || dimmed) continue;
    context.fillStyle = tokens.tile;
    context.font = monoFont(SEGMENT_LABEL_SIZE);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const text = segment.label === 'detail' ? `${segment.id} · ${fmtMs(segment.ms)}` : segment.id;
    context.fillText(text, segment.centerX, segment.y + segment.height / 2, segment.width - 4);
  }
  context.textBaseline = 'alphabetic';
}

function paint(context: CanvasRenderingContext2D, props: OperationSplitCanvasProps, scale: number) {
  const { geometry, palette, selectedOperation } = props;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, SPLIT_PLOT.width, SPLIT_PLOT.height);

  // ---- the ruler both lanes are measured on
  context.strokeStyle = withAlpha(tokens.hair, 0.55);
  context.lineWidth = 1;
  for (const tick of geometry.ticks) {
    context.beginPath();
    context.moveTo(tick.x, SPLIT_PLOT.phaseY);
    context.lineTo(tick.x, SPLIT_PLOT.rulerY);
    context.stroke();
  }
  context.strokeStyle = withAlpha(tokens.sub2, 0.45);
  context.beginPath();
  context.moveTo(SPLIT_PLOT.gutter, SPLIT_PLOT.rulerY);
  context.lineTo(SPLIT_PLOT.width - SPLIT_PLOT.right, SPLIT_PLOT.rulerY);
  context.stroke();
  context.fillStyle = tokens.sub2;
  context.font = monoFont(AXIS_LABEL_SIZE);
  context.textAlign = 'center';
  for (const tick of geometry.ticks) {
    context.fillText(fmtInt(tick.value), tick.x, SPLIT_PLOT.rulerY + 12);
  }
  context.textAlign = 'left';
  context.font = monoFont(LANE_SUB_SIZE);
  context.fillText(
    'millisecond of the replica critical path',
    SPLIT_PLOT.gutter,
    SPLIT_PLOT.rulerY + 26,
  );

  // ---- the joins, under the lanes they connect
  for (const ribbon of geometry.ribbons) {
    const chosen = ribbon.operation === selectedOperation;
    if (selectedOperation !== null && !chosen) continue;
    context.strokeStyle = palette.colorOf(ribbon.operation);
    context.globalAlpha = chosen ? 0.85 : 0.24;
    context.lineWidth = chosen ? 1.5 : 0.9;
    context.beginPath();
    context.moveTo(ribbon.fromX, ribbon.topY);
    context.bezierCurveTo(
      ribbon.fromX,
      ribbon.topY + RIBBON_CONTROL_REACH,
      ribbon.toX,
      ribbon.bottomY - RIBBON_CONTROL_REACH,
      ribbon.toX,
      ribbon.bottomY,
    );
    context.stroke();
  }
  context.globalAlpha = 1;

  drawStack(context, geometry.measured, palette, selectedOperation);
  drawStack(context, geometry.simulated, palette, selectedOperation);

  // ---- phases, annotated over the measured lane rather than cut into it
  context.setLineDash([2, 3]);
  context.strokeStyle = withAlpha(tokens.sub2, 0.55);
  context.lineWidth = 1;
  for (const mark of geometry.phaseMarks) {
    if (mark.ruleX === null) continue;
    context.beginPath();
    context.moveTo(mark.ruleX, SPLIT_PLOT.phaseY - 6);
    context.lineTo(mark.ruleX, SPLIT_PLOT.measuredY + SPLIT_PLOT.laneHeight);
    context.stroke();
  }
  context.setLineDash([]);
  context.fillStyle = tokens.sub;
  context.font = monoFont(PHASE_MARK_SIZE);
  context.textAlign = 'center';
  for (const mark of geometry.phaseMarks) {
    if (!mark.labelled || mark.phase.length === 0) continue;
    context.fillText(mark.phase, mark.centerX, SPLIT_PLOT.phaseY - 1);
  }

  // ---- what each lane is
  context.textAlign = 'left';
  context.fillStyle = tokens.ink;
  context.font = monoFont(LANE_NAME_SIZE);
  context.fillText('nsight measured', 8, SPLIT_PLOT.measuredY + 15);
  context.fillText('timing-predict', 8, SPLIT_PLOT.simulatedY + 15);
  context.fillStyle = tokens.sub2;
  context.font = monoFont(LANE_SUB_SIZE);
  context.fillText(
    `${fmtMs(props.measuredTotalMs)} · ${fmtInt(props.groups.length)} groups`,
    8,
    SPLIT_PLOT.measuredY + 28,
  );
  context.fillText(
    `${fmtMs(props.simulatedTotalMs)} · ${fmtInt(props.slots.length)} slots`,
    8,
    SPLIT_PLOT.simulatedY + 28,
  );

  // ---- where the difference accumulates
  const { cumulative } = geometry;
  for (const band of cumulative.bands) {
    const dimmed = selectedOperation !== null && band.operation !== selectedOperation;
    context.globalAlpha = dimmed ? 0.04 : 0.13;
    context.fillStyle = palette.colorOf(band.operation);
    context.fillRect(band.x, SPLIT_PLOT.stepY, band.width, SPLIT_PLOT.stepHeight);
  }
  context.globalAlpha = 1;
  context.setLineDash([3, 3]);
  context.strokeStyle = tokens.sub2;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(SPLIT_PLOT.gutter, cumulative.zeroY);
  context.lineTo(SPLIT_PLOT.width - SPLIT_PLOT.right, cumulative.zeroY);
  context.stroke();
  context.setLineDash([]);

  context.strokeStyle = tokens.violet;
  context.lineWidth = 1.4;
  context.lineJoin = 'round';
  context.beginPath();
  cumulative.path.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.fillStyle = tokens.violet;
  for (const [x, y] of cumulative.dots) {
    context.beginPath();
    context.arc(x, y, 1.9, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = tokens.ink;
  context.font = monoFont(STEP_LABEL_SIZE);
  context.textAlign = 'right';
  context.fillText(
    `total ${fmtSignedMs(cumulative.totalDeltaMs)} (${fmtSignedPct(props.relativeDiffPct)})`,
    cumulative.endX - 6,
    cumulative.endY - 7,
  );
  context.fillStyle = tokens.sub2;
  context.textAlign = 'left';
  context.font = monoFont(LANE_SUB_SIZE);
  context.fillText('cumulative', 8, SPLIT_PLOT.stepY + 12);
  context.fillText('modelled − measured', 8, SPLIT_PLOT.stepY + 24);
  context.fillText('(ms)', 8, SPLIT_PLOT.stepY + 36);
  context.textAlign = 'right';
  context.font = monoFont(AXIS_LABEL_SIZE);
  context.fillText(fmtInt(0), SPLIT_PLOT.gutter - 6, cumulative.zeroY + 3);
  context.fillText(fmtInt(cumulative.lowMs), SPLIT_PLOT.gutter - 6, cumulative.lowY + 3);
}

function segmentAt(segments: readonly StackSegment[], x: number, y: number): StackSegment | null {
  return (
    segments.find(
      (segment) =>
        x >= segment.x &&
        x <= segment.x + segment.width &&
        y >= segment.y &&
        y <= segment.y + segment.height,
    ) ?? null
  );
}

export default function OperationSplitCanvas(props: OperationSplitCanvasProps) {
  const {
    geometry,
    groups,
    slots,
    measuredTotalMs,
    simulatedTotalMs,
    relativeDiffPct,
    palette,
    selectedOperation,
    onSelectOperation,
    ariaLabel,
  } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hostWidth, setHostWidth] = useState<number>(SPLIT_PLOT.width);
  const [hovered, setHovered] = useState<HoveredSegment | null>(null);
  const scale = hostWidth / SPLIT_PLOT.width;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const measure = (): void => setHostWidth(Math.max(1, host.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    if (canvas === null || context === null) return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(hostWidth * pixelRatio);
    canvas.height = Math.round(SPLIT_PLOT.height * scale * pixelRatio);
    paint(
      context,
      {
        geometry,
        groups,
        slots,
        measuredTotalMs,
        simulatedTotalMs,
        relativeDiffPct,
        palette,
        selectedOperation,
        onSelectOperation,
        ariaLabel,
      },
      scale * pixelRatio,
    );
  }, [
    geometry,
    groups,
    slots,
    measuredTotalMs,
    simulatedTotalMs,
    relativeDiffPct,
    palette,
    selectedOperation,
    onSelectOperation,
    ariaLabel,
    scale,
    hostWidth,
  ]);

  const locate = useCallback(
    (
      clientX: number,
      clientY: number,
    ): { segment: StackSegment; side: 'measured' | 'simulated' } | null => {
      const canvas = canvasRef.current;
      if (canvas === null) return null;
      const box = canvas.getBoundingClientRect();
      const x = (clientX - box.left) / scale;
      const y = (clientY - box.top) / scale;
      const measured = segmentAt(geometry.measured, x, y);
      if (measured !== null) return { segment: measured, side: 'measured' };
      const simulated = segmentAt(geometry.simulated, x, y);
      return simulated === null ? null : { segment: simulated, side: 'simulated' };
    },
    [geometry, scale],
  );

  const hoveredDetail = useMemo(() => {
    if (hovered === null) return null;
    if (hovered.side === 'measured') {
      const group = groups[hovered.index];
      if (group === undefined) return null;
      return {
        title: `${group.id} · ${group.operation ?? group.kernelName}`,
        rows: [
          ...(group.phase.length > 0 ? [['phase', group.phase] as const] : []),
          ['launches', fmtInt(group.launches)] as const,
          ['kernel rows folded', fmtInt(group.foldedRows)] as const,
          ['duration', fmtMs(group.ms)] as const,
          ['operation', group.operation ?? 'unmapped'] as const,
        ],
      };
    }
    const slot = slots[hovered.index];
    if (slot === undefined) return null;
    return {
      title: `${slot.id} · ${slot.name}`,
      rows: [
        ['kind', slot.kind] as const,
        ['multiplicity', `×${fmtInt(slot.multiplicity)}`] as const,
        [MODELLED_SLOT_FIELD, fmtMs(slot.ms)] as const,
        ['operation', slot.operation ?? 'unmapped'] as const,
      ],
    };
  }, [hovered, groups, slots]);

  return (
    <Box ref={hostRef} sx={{ position: 'relative', width: '100%' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{
          display: 'block',
          width: '100%',
          height: `${SPLIT_PLOT.height * scale}px`,
          cursor: hovered === null ? 'default' : 'pointer',
        }}
        onPointerMove={(event) => {
          const found = locate(event.clientX, event.clientY);
          if (found === null) {
            setHovered((current) => (current === null ? current : null));
            return;
          }
          setHovered((current) =>
            current !== null && current.side === found.side && current.index === found.segment.index
              ? current
              : {
                  side: found.side,
                  index: found.segment.index,
                  x: found.segment.centerX * scale,
                  y: (found.segment.y + found.segment.height + 8) * scale,
                },
          );
        }}
        onPointerLeave={() => setHovered(null)}
        onClick={(event) => {
          const operation = locate(event.clientX, event.clientY)?.segment.operation ?? null;
          onSelectOperation(
            operation !== null && operation !== selectedOperation ? operation : null,
          );
        }}
      />
      {hovered !== null && hoveredDetail !== null && (
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            zIndex: 3,
            pointerEvents: 'none',
            width: TOOLTIP_WIDTH,
            left: Math.min(
              Math.max(4, hovered.x - TOOLTIP_WIDTH / 2),
              Math.max(4, hostWidth - TOOLTIP_WIDTH - 4),
            ),
            top: hovered.y,
            p: '7px 9px',
            borderRadius: 1,
            border: `1px solid ${tokens.hair}`,
            background: tokens.leafbg,
            boxShadow: tokens.shadow,
            fontFamily: tokens.mono,
            fontSize: 9,
            color: tokens.sub,
          }}
        >
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontSize: 10,
              color: tokens.ink,
              mb: 0.4,
              wordBreak: 'break-all',
            }}
          >
            {hoveredDetail.title}
          </Typography>
          {hoveredDetail.rows.map(([term, value]) => (
            <Box key={term} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.75 }}>
              <span>{term}</span>
              <span style={{ color: tokens.ink }}>{value}</span>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
