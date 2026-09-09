import { Box, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';

import SurfaceCard from '../../components/SurfaceCard';
import type {
  AlignmentTimelineIndex,
  AlignmentTimelineIteration,
  AlignmentTimelineIterationSummary,
} from '../../domain/alignment';
import { tokens, withAlpha } from '../../theme';
import { spanOf, type AxisSpan } from './axisZoom';
import {
  dutyBreakdown,
  dutySegments,
  forwardIdleFraction,
  iterationDutyRatio,
  widestForwardGap,
  type DutyBreakdown,
} from './dutyBreakdown';
import { fmtInt, fmtMs, fmtMultiplier, fmtPct, fmtSignedMs } from './format';
import { groupedHostLanes, HOST_NVTX_DEPTHS, type HostLaneCensus } from './hostLanes';
import IterationTimelineCanvas from './IterationTimelineCanvas';
import SubjectError from './SubjectError';
import {
  ITERATION_ORDERS,
  findIteration,
  orderedIterationIndices,
  stepSelection,
  type IterationOrderKey,
} from './iterationPicker';
import { continuousScene, type ContinuousSceneInput } from './timelineGeometry';
import { useNeighbourIterations } from './wallClockNeighbours';
import {
  apiClassColor,
  DUTY_SEGMENT_COLORS,
  nvtxDepthColor,
  operationColors,
  unmappedColor,
} from './wallClockPalette';
import WallClockPicker from './wallClockPicker';
import { gapEdgeLabel } from './wallClockText';
import { traceConnections, type TimelineTrace } from './timelineSelection';

/**
 * §04 — where one iteration's wall clock went.
 *
 * A percentage says how wrong the model is. The span says where the GPU was
 * while being wrong, and how much of it no kernel occupied at all — the part
 * the duty multiplier exists to cover. The bar and the lanes are the same
 * iteration at two zooms, which is why they share one card and one selection.
 */
export default function WallClockCard({
  alignmentId,
  index,
  iteration,
  iterationError,
  loading,
  selectedIterationId,
  onSelectIteration,
}: {
  alignmentId: string;
  index: AlignmentTimelineIndex;
  iteration: AlignmentTimelineIteration | null;
  /** The per-iteration shard is fetched separately from the index, so it can
   * fail on its own; the lanes report that rather than staying blank. */
  iterationError: unknown;
  loading: boolean;
  selectedIterationId: number | null;
  onSelectIteration: (iterationId: number) => void;
}) {
  const [orderKey, setOrderKey] = useState<IterationOrderKey>('run');
  const [selectedTrace, setSelectedTrace] = useState<TimelineTrace | null>(null);
  const [plotWidthPx, setPlotWidthPx] = useState(0);
  const [timelineViewport, setTimelineViewport] = useState<AxisSpan | null>(null);

  useEffect(() => setSelectedTrace(null), [selectedIterationId]);

  const ordered = useMemo(
    () => orderedIterationIndices(index.iterations, orderKey),
    [index.iterations, orderKey],
  );
  const order = ITERATION_ORDERS.find((entry) => entry.key === orderKey);
  // The index row, which is present the instant a bar is clicked; the shard
  // behind it is a separate fetch. The heading reads from this so that stepping
  // through the picker never blanks the thing that says what is selected.
  const summary = findIteration(index.iterations, selectedIterationId);
  const neighbours = useNeighbourIterations(alignmentId, index, selectedIterationId, iteration);

  const step = useCallback(
    (delta: number) => {
      if (selectedIterationId === null) return;
      onSelectIteration(stepSelection(ordered, index.iterations, selectedIterationId, delta));
    },
    [ordered, index.iterations, selectedIterationId, onSelectIteration],
  );

  const referenceDeviceId = index.meta.referenceDeviceId;
  const breakdown = useMemo(
    () => (iteration === null ? null : dutyBreakdown(iteration, referenceDeviceId)),
    [iteration, referenceDeviceId],
  );
  const palette = useMemo(
    () => ({
      operationColors: operationColors(index.operations),
      operationTypes: Object.fromEntries(
        index.operations.map((entry) => [entry.operation, entry.type]),
      ),
      unmappedColor,
    }),
    [index.operations],
  );

  const sceneInputs = useMemo<readonly ContinuousSceneInput[]>(() => {
    if (iteration === null) return [];
    const entries: ContinuousSceneInput[] = [];
    const push = (role: ContinuousSceneInput['role'], row: AlignmentTimelineIteration | null) => {
      if (row === null) return;
      entries.push({ role, iteration: row, breakdown: dutyBreakdown(row, referenceDeviceId) });
    };
    push('before', neighbours.before);
    push('selected', iteration);
    push('after', neighbours.after);
    return entries;
  }, [iteration, neighbours.before, neighbours.after, referenceDeviceId]);

  const scene = useMemo(
    () =>
      continuousScene(sceneInputs, {
        kernelNames: index.kernelNames,
        referenceDeviceId,
        slotMultiplicity: index.slotMultiplicity,
        slots: index.simSlots,
        simNodes: index.simNodes,
        palette,
      }),
    [sceneInputs, index, referenceDeviceId, palette],
  );

  const host = useMemo(
    () =>
      scene === null
        ? null
        : groupedHostLanes(
            sceneInputs.map((input, position) => ({
              iteration: input.iteration,
              offsetMs: scene.lanes[position].offsetMs,
            })),
            index.meta.hostTimeline,
            referenceDeviceId,
            { startMs: scene.startMs, endMs: scene.endMs },
          ),
    [scene, sceneInputs, index.meta.hostTimeline, referenceDeviceId],
  );

  const forwardGap = useMemo(
    () => (iteration === null ? null : widestForwardGap(iteration, referenceDeviceId)),
    [iteration, referenceDeviceId],
  );
  const dutyRatio = iteration === null ? null : iterationDutyRatio(iteration);

  const handleTraceSelect = useCallback((trace: TimelineTrace | null) => {
    setSelectedTrace(trace);
  }, []);

  const selectedConnection = useMemo(() => {
    if (selectedTrace === null || scene === null) return null;
    return traceConnections(selectedTrace, scene, host)[0] ?? null;
  }, [host, scene, selectedTrace]);

  const linkedTrace = useMemo(() => {
    if (selectedTrace === null || selectedConnection === null) return null;
    if (selectedTrace.kind === 'api') return selectedConnection.kernel;
    if (selectedConnection.kernel.id === selectedTrace.id) {
      return selectedConnection.simulation ?? selectedConnection.api;
    }
    return selectedConnection.kernel;
  }, [selectedConnection, selectedTrace]);

  const launchTrace =
    selectedConnection?.api?.id === selectedTrace?.id ? null : (selectedConnection?.api ?? null);

  return (
    <Stack sx={{ gap: 1.25 }}>
      <SurfaceCard>
        <CardHead
          title="Pick an iteration"
          meta={`${fmtInt(index.meta.iterationsEmitted)} iterations, all selectable · lanes for ${fmtInt(
            neighbours.loaded,
          )} of ${fmtInt(neighbours.requested)} loaded · ${fmtInt(neighbours.cached)} cached${
            index.iterationDetail === null
              ? ''
              : ` · one record per iteration in ${index.iterationDetail.file}`
          }`}
        />

        <Box sx={{ p: '10px 14px 4px', borderBottom: `1px solid ${tokens.hair}` }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'baseline', gap: 1.5, pb: 0.75, flexWrap: 'wrap' }}
          >
            <Typography
              sx={{
                fontFamily: tokens.body,
                fontSize: 12,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: tokens.sub,
              }}
            >
              idle share of the reference rank&apos;s span (%)
            </Typography>
            {ITERATION_ORDERS.map((entry) => (
              <Chip
                key={entry.key}
                label={entry.label}
                pressed={entry.key === orderKey}
                onClick={() => setOrderKey(entry.key)}
              />
            ))}
            <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
              {order?.note}
            </Typography>
          </Stack>

          <WallClockPicker
            iterations={index.iterations}
            ordered={ordered}
            selectedIterationId={selectedIterationId}
            onSelectIteration={onSelectIteration}
            onStep={step}
            orderLabel={order?.label ?? ''}
          />

          <Typography
            sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub2, p: '2px 0 6px' }}
          >
            scroll or <Key>ctrl</Key>+scroll to zoom · zoom in until names fit · click a kernel,{' '}
            simulation slot, or CUDA API to inspect · <Key>←</Key> <Key>→</Key> step ·{' '}
            <Key>pgup</Key> <Key>pgdn</Key> jump 25 · <Key>home</Key> <Key>end</Key> · bar height is
            idle share, colour is iteration type
          </Typography>
        </Box>
      </SurfaceCard>

      <SurfaceCard>
        <CardHead
          title="Selected iteration data"
          meta={
            summary === null
              ? 'select an iteration to inspect'
              : `iteration ${summary.iterationId} · ${summary.iterationType}`
          }
        />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) minmax(230px,.34fr)' },
            borderBottom: `1px solid ${tokens.hair}`,
          }}
        >
          <Box sx={{ p: '14px 16px 6px' }}>
            {summary === null ? (
              <Skeleton variant="rounded" height={64} />
            ) : (
              <DutyDecomposition
                summary={summary}
                breakdown={breakdown}
                referenceDeviceId={referenceDeviceId}
                widestForward={
                  forwardGap === null
                    ? null
                    : {
                        ms: (forwardGap.gap.endNs - forwardGap.gap.startNs) / 1e6,
                        edge: gapEdgeLabel(forwardGap.fromOperation, forwardGap.toOperation),
                      }
                }
              />
            )}
          </Box>
          <Box
            sx={{
              borderLeft: { lg: `1px solid ${tokens.hair}` },
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <Multiplier
              value={dutyRatio === null ? null : fmtMultiplier(dutyRatio)}
              label="this iteration · gpu cycle ÷ kernel critical path"
              // The two numbers in this panel are measured on different bases,
              // and read together without that said they contradict each other:
              // the lane's idle is one rank's bubbles, while the critical path
              // charges every position to its slowest rank. A rank waiting on
              // its peers is idle on the lane and inside the critical path at
              // the same time, which is why a lock-step DP capture can show
              // several percent idle and still divide out to ~1.
              note="critical path charges each position to its slowest rank, so the idle above — waiting on a peer rank — is already counted inside it"
            />
          </Box>
        </Box>
      </SurfaceCard>

      <SurfaceCard>
        <CardHead
          title="Measured NSYS lane against the modelled cost tree"
          meta={
            scene === null
              ? `reference rank ${referenceDeviceId} · one continuous axis`
              : timelineMeta(scene, plotWidthPx, referenceDeviceId, timelineViewport)
          }
        />

        {neighbours.error != null && (
          <Box sx={{ p: '10px 16px 0' }}>
            <SubjectError error={neighbours.error} />
          </Box>
        )}

        {iterationError != null ? (
          <Box sx={{ p: 2 }}>
            <SubjectError error={iterationError} />
          </Box>
        ) : loading && iteration === null ? (
          <Skeleton variant="rounded" height={420} sx={{ m: 2 }} />
        ) : scene === null ? (
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.body, fontSize: 12, p: 2 }}>
            Select an iteration to draw its lanes.
          </Typography>
        ) : (
          <>
            <IterationTimelineCanvas
              scene={scene}
              host={host}
              referenceDeviceId={referenceDeviceId}
              selectedTrace={selectedTrace}
              onStep={step}
              onSelectTrace={handleTraceSelect}
              onPlotWidth={setPlotWidthPx}
              onViewport={setTimelineViewport}
              ariaLabel={`Iterations ${scene.lanes
                .map((lane) => lane.iterationId)
                .join(
                  ', ',
                )} on one continuous reference-rank axis, host lanes above device lanes. Scroll or ctrl+scroll to zoom the time axis, drag to pan, shift with an arrow key to step iteration`}
            />
            <TimelineTraceReadout
              trace={selectedTrace}
              linkedTrace={linkedTrace}
              launchTrace={launchTrace}
              apiClassNames={index.meta.hostTimeline?.apiClasses ?? []}
            />
          </>
        )}

        {host !== null && <HostLegend host={host} />}
      </SurfaceCard>
    </Stack>
  );
}

function TimelineTraceReadout({
  trace,
  linkedTrace,
  launchTrace,
  apiClassNames,
}: {
  trace: TimelineTrace | null;
  linkedTrace: TimelineTrace | null;
  launchTrace: TimelineTrace | null;
  apiClassNames: readonly string[];
}) {
  if (trace === null) return null;
  const kind =
    trace.kind === 'api' ? 'CUDA API' : trace.kind === 'kernel' ? 'kernel' : 'simulation slot';
  const apiClassName =
    trace.apiClassIndex === null
      ? 'unknown class'
      : (apiClassNames[trace.apiClassIndex] ?? `class ${trace.apiClassIndex}`);
  const correlation = trace.correlationId === null ? 'unavailable' : `${trace.correlationId}`;
  const details: readonly (readonly [string, string])[] =
    trace.kind === 'api'
      ? [
          ['time on shared axis', `${fmtMs(trace.startMs)} → ${fmtMs(trace.endMs)}`],
          ['duration', fmtMs(trace.endMs - trace.startMs)],
          ['lane', trace.laneKey],
          ['API class', apiClassName],
          ['NSYS correlation', correlation],
        ]
      : trace.kind === 'kernel'
        ? [
            ['time on shared axis', `${fmtMs(trace.startMs)} → ${fmtMs(trace.endMs)}`],
            ['duration', fmtMs(trace.endMs - trace.startMs)],
            ['iteration', `${trace.iterationId}`],
            ['operation', trace.operation ?? 'unmapped'],
            ['phase', trace.phase ?? 'unphased'],
            ['row', trace.rowId ?? 'unmapped row'],
            ['NSYS correlation', correlation],
          ]
        : [
            ['time on shared axis', `${fmtMs(trace.startMs)} → ${fmtMs(trace.endMs)}`],
            ['duration', fmtMs(trace.endMs - trace.startMs)],
            ['iteration', `${trace.iterationId}`],
            ['operation', trace.operation ?? 'unmapped'],
            ['slot', `${trace.slotIndex ?? '—'}`],
            ['kind', trace.slotKind ?? 'unknown kind'],
            ['NSYS correlation', correlation],
          ];
  return (
    <Box
      role="status"
      sx={{
        mx: 2,
        mb: 1.25,
        border: `1px solid ${tokens.teal}`,
        borderRadius: '9px',
        background: withAlpha(tokens.teal, 0.045),
        overflow: 'hidden',
      }}
    >
      <Stack sx={{ gap: 1.4, p: '13px 15px 14px' }}>
        <Stack sx={{ gap: 0.55, minWidth: 0, width: '100%' }}>
          <Typography
            sx={{
              color: tokens.teal,
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
            }}
          >
            selected {kind}
          </Typography>
          <Typography
            sx={{
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 13.5,
              fontWeight: 600,
              lineHeight: 1.35,
              overflowWrap: 'anywhere',
            }}
          >
            {trace.label}
          </Typography>
          <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
            {trace.kind === 'api'
              ? 'NSYS host-side runtime event'
              : launchTrace === null
                ? 'one-to-one operation-order link'
                : 'NSYS correlation-linked launch + one-to-one operation-order link'}
          </Typography>
        </Stack>

        <Box
          sx={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              lg: 'repeat(6, minmax(0, 1fr))',
            },
            gap: '10px 18px',
          }}
        >
          {details.map(([label, value]) => (
            <TraceDetail key={label} label={label} value={value} />
          ))}
        </Box>
      </Stack>

      {linkedTrace !== null && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            gap: '4px 12px',
            alignItems: { sm: 'baseline' },
            borderTop: `1px solid ${tokens.hair}`,
            p: '9px 15px 10px',
            fontFamily: tokens.body,
            fontSize: 12,
          }}
        >
          <Box component="span" sx={{ color: tokens.teal, textTransform: 'uppercase' }}>
            paired {linkedTrace.kind === 'kernel' ? 'kernel' : 'simulation slot'}
          </Box>
          <Box
            component="span"
            sx={{ color: tokens.ink, fontWeight: 600, overflowWrap: 'anywhere' }}
          >
            {linkedTrace.label}
          </Box>
          <Box component="span" sx={{ color: tokens.sub }}>
            {fmtMs(linkedTrace.startMs)} → {fmtMs(linkedTrace.endMs)} ·{' '}
            {fmtMs(linkedTrace.endMs - linkedTrace.startMs)}
          </Box>
        </Stack>
      )}

      {launchTrace !== null && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            gap: '4px 12px',
            alignItems: { sm: 'baseline' },
            borderTop: `1px solid ${tokens.hair}`,
            p: '9px 15px 10px',
            fontFamily: tokens.body,
            fontSize: 12,
          }}
        >
          <Box component="span" sx={{ color: tokens.teal, textTransform: 'uppercase' }}>
            launch
          </Box>
          <Box
            component="span"
            sx={{ color: tokens.ink, fontWeight: 600, overflowWrap: 'anywhere' }}
          >
            {launchTrace.label}
          </Box>
          <Box component="span" sx={{ color: tokens.sub }}>
            {fmtMs(launchTrace.startMs)} → {fmtMs(launchTrace.endMs)} ·{' '}
            {fmtMs(launchTrace.endMs - launchTrace.startMs)} · correlation{' '}
            {launchTrace.correlationId ?? 'unavailable'}
          </Box>
        </Stack>
      )}
    </Box>
  );
}

function TraceDetail({ label, value }: { label: string; value: string }) {
  return (
    <Stack sx={{ gap: 0.25, minWidth: 0 }}>
      <Typography
        sx={{
          color: tokens.sub2,
          fontFamily: tokens.body,
          fontSize: 12,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          color: tokens.ink,
          fontFamily: tokens.body,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function timelineMeta(
  scene: NonNullable<ReturnType<typeof continuousScene>>,
  plotWidthPx: number,
  referenceDeviceId: number,
  /** Null until the canvas has reported one, which is one frame after mount. */
  viewport: AxisSpan | null,
): string {
  const spanMs = scene.endMs - scene.startMs;
  // The resolution belongs to what is drawn, not to what was captured: after a
  // zoom the same pixels carry the window, and quoting the whole axis here
  // would overstate how coarse the lanes are by the zoom factor.
  const drawnMs = viewport === null ? spanMs : spanOf(viewport);
  const perPixel = plotWidthPx > 0 ? ` · ${fmtMs(drawnMs / plotWidthPx)} per pixel` : '';
  const between = scene.interIterationGaps.map((gap) => fmtMs(gap.endMs - gap.startMs)).join(' · ');
  return (
    `reference rank ${referenceDeviceId} · one continuous axis · ${fmtMs(spanMs)} of capture` +
    `${perPixel} · between iterations ${between.length > 0 ? between : 'none'}`
  );
}

function CardHead({ title, meta }: { title: string; meta: string }) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{
        alignItems: { md: 'baseline' },
        justifyContent: 'space-between',
        gap: 1,
        p: '12px 16px 10px',
        borderBottom: `1px solid ${tokens.hair}`,
      }}
    >
      <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
        {title}
      </Typography>
      <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
        {meta}
      </Typography>
    </Stack>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        fontFamily: tokens.body,
        fontSize: 12,
        border: `1px solid ${tokens.hair}`,
        borderRadius: '4px',
        px: '4px',
        color: tokens.sub,
      }}
    >
      {children}
    </Box>
  );
}

function Chip({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      sx={{
        appearance: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontFamily: tokens.body,
        fontSize: 12,
        padding: '3px 9px',
        borderRadius: '7px',
        border: `1px solid ${pressed ? tokens.teal : tokens.hair}`,
        color: pressed ? tokens.teal : tokens.sub,
        background: pressed ? withAlpha(tokens.teal, 0.08) : tokens.leafbg,
      }}
    >
      {label}
    </Box>
  );
}

/** The span as five parts, plus the one sentence that says where its widest
 * forward hole was and what it sat between. */
function DutyDecomposition({
  summary,
  breakdown,
  referenceDeviceId,
  widestForward,
}: {
  summary: AlignmentTimelineIterationSummary;
  /** Null while this iteration's shard is still in flight. The heading and the
   * span come from the index either way, so a step through the picker never
   * blanks the line that says what is selected — only the bar waits. */
  breakdown: DutyBreakdown | null;
  referenceDeviceId: number;
  widestForward: { ms: number; edge: string } | null;
}) {
  const segments = breakdown === null ? [] : dutySegments(breakdown);
  const forwardIdle = breakdown === null ? null : forwardIdleFraction(breakdown);
  return (
    <>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ alignItems: { md: 'baseline' }, justifyContent: 'space-between', gap: 1, mb: 1 }}
      >
        <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.ink }}>
          iteration {summary.iterationId} · {summary.iterationType}
        </Typography>
        <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
          rank-{referenceDeviceId}
          {breakdown !== null &&
            ` · ${
              widestForward === null
                ? 'no forward gap recorded'
                : `widest forward gap ${fmtMs(widestForward.ms)} at ${widestForward.edge}`
            }`}
        </Typography>
      </Stack>
      <Stack
        direction="row"
        sx={{ flexWrap: 'wrap', gap: '4px 14px', mb: 1.25, fontFamily: tokens.body, fontSize: 12 }}
      >
        <Cell label="span" value={fmtMs(summary.spanMs)} />
        <Cell label="idle" value={fmtPct(summary.idleFraction * 100)} />
        <Cell
          label="forward idles"
          value={forwardIdle === null ? '—' : fmtPct(forwardIdle * 100)}
        />
        <Cell label="measured" value={fmtMs(summary.measuredMs)} />
        <Cell label="modelled" value={fmtMs(summary.simulatedMs)} />
        <Cell label="Δ" value={fmtSignedMs(summary.simulatedMs - summary.measuredMs)} />
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          {fmtInt(summary.gapCount)} gaps
        </Box>
      </Stack>
      <Stack
        direction="row"
        role="img"
        aria-label={
          breakdown === null
            ? 'Loading this iteration’s span'
            : segments.map((segment) => `${segment.label} ${fmtMs(segment.ms)}`).join(', ')
        }
        sx={{
          height: 26,
          borderRadius: '6px',
          overflow: 'hidden',
          border: `1px solid ${tokens.hair}`,
          background: tokens.tile2,
        }}
      >
        {segments.map((segment) => (
          <Tooltip
            key={segment.key}
            title={`${segment.label} — ${fmtMs(segment.ms)}`}
            describeChild
          >
            <Box
              sx={{
                width: `${(segment.ms / Math.max(summary.spanMs, 1e-9)) * 100}%`,
                background: DUTY_SEGMENT_COLORS[segment.key],
              }}
            />
          </Tooltip>
        ))}
      </Stack>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: '3px 16px', m: '8px 0 12px' }}>
        {segments.map((segment) => (
          <Stack key={segment.key} direction="row" alignItems="center" sx={{ gap: 0.75 }}>
            <Swatch color={DUTY_SEGMENT_COLORS[segment.key]} />
            <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
              {segment.label}{' '}
              <Box component="span" sx={{ color: tokens.ink, fontWeight: 600 }}>
                {fmtMs(segment.ms)}
              </Box>
            </Typography>
          </Stack>
        ))}
      </Stack>
    </>
  );
}

function Swatch({ color }: { color: string }) {
  return <Box sx={{ width: 9, height: 9, borderRadius: '2px', background: color, flex: 'none' }} />;
}

function Multiplier({
  value,
  label,
  note,
}: {
  value: string | null;
  label: string;
  note?: string;
}) {
  return (
    <Box
      sx={{
        p: '16px 17px 15px',
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 'clamp(28px, 3vw, 40px)',
          lineHeight: 1,
          letterSpacing: '-.02em',
          fontVariantNumeric: 'tabular-nums',
          color: tokens.ink,
        }}
      >
        {value ?? '—'}
      </Typography>
      <Typography
        sx={{
          fontFamily: tokens.body,
          fontSize: 12,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: tokens.sub2,
          mt: 1,
          lineHeight: 1.6,
        }}
      >
        {label}
      </Typography>
      {note === undefined ? null : (
        <Typography
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.sub2,
            mt: 0.75,
            lineHeight: 1.5,
          }}
        >
          {note}
        </Typography>
      )}
    </Box>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      {label}{' '}
      <Box
        component="span"
        sx={{ color: tokens.ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Box>
    </Box>
  );
}

/**
 * The CPU lanes' key: which classes of call are on screen, how many, and how
 * much wall clock they hold — plus the two rules that decide what a host row
 * belongs to, taken from the extractor rather than written here.
 */
function HostLegend({ host }: { host: HostLaneCensus }) {
  return (
    <Stack
      direction="row"
      sx={{
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '4px 14px',
        p: '10px 16px 12px',
        borderTop: `1px solid ${tokens.hair}`,
        mt: 1.25,
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.75 }}>
        <Swatch color={nvtxDepthColor(0)} />
        <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
          nvtx range <Strong>{fmtInt(host.nvtxMarks)}</Strong> marks · nesting shown to{' '}
          <Strong>{fmtInt(HOST_NVTX_DEPTHS)}</Strong> levels
          {host.deeperMarks > 0 && (
            <>
              {' · '}
              <Strong>{fmtInt(host.deeperMarks)}</Strong> deeper not drawn
            </>
          )}
          {host.offAxisRows > 0 && (
            <>
              {' · '}
              <Strong>{fmtInt(host.offAxisRows)}</Strong> rows wholly off this axis
            </>
          )}
        </Typography>
      </Stack>
      {host.apiTotals.map((entry) => (
        <Stack key={entry.class} direction="row" alignItems="center" sx={{ gap: 0.75 }}>
          <Swatch color={apiClassColor(entry.classIndex)} />
          <Typography
            sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub, whiteSpace: 'nowrap' }}
          >
            {entry.class} <Strong>{fmtInt(entry.calls)}</Strong> calls ·{' '}
            <Strong>{fmtMs(entry.ms)}</Strong>
          </Typography>
        </Stack>
      ))}
      {/* What is NOT on screen, which no reader can infer from the lanes, and
          — behind a hover — the analyzer's own account of how a host event was
          assigned to an iteration. That account is two paragraphs of
          methodology: correct, unchanging, and not what anyone is looking at
          this legend to find out. */}
      {host.hiddenThreadCount > 0 && (
        <Tooltip title={`${host.windowRule}\n\n${host.ownershipRule}`} placement="top-start">
          <Typography
            sx={{
              flex: '1 1 100%',
              fontSize: 12,
              color: tokens.sub2,
              lineHeight: 1.5,
              pt: 0.25,
              cursor: 'help',
            }}
          >
            {`${fmtInt(host.hiddenThreadCount)} further host threads (${host.hiddenThreadRoles.join(', ')} of the other ranks) are not drawn`}
          </Typography>
        </Tooltip>
      )}
    </Stack>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ color: tokens.ink, fontWeight: 600 }}>
      {children}
    </Box>
  );
}
