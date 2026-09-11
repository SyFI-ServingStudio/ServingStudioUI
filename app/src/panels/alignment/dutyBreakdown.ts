import type { AlignmentTimelineIteration } from '../../artifacts/schema/alignmentTypes';

/**
 * Where one iteration's wall clock went on the reference rank.
 *
 * Everything here is derived from `measured.kernels[].intervals` — the raw,
 * unreduced per-rank launches — and never from drawn geometry. At the zoom a
 * card can afford, one pixel is tens of microseconds, so a gap measured from
 * rectangles would be a gap the renderer invented.
 *
 * The split is phase-wise because that is the only boundary the capture
 * actually marks: within a phase the GPU is either running a kernel or idle,
 * and between phases it is waiting on the host. Collapsing those two kinds of
 * emptiness into one "idle" number would hide the distinction the whole host
 * lane exists to show.
 */

export interface TimeInterval {
  readonly startNs: number;
  readonly endNs: number;
}

export interface PhaseOccupancy {
  readonly phase: string;
  readonly extent: TimeInterval;
  readonly busyMs: number;
  readonly idleMs: number;
}

export interface DutyBreakdown {
  readonly spanMs: number;
  readonly busyMs: number;
  readonly idleMs: number;
  readonly phases: readonly PhaseOccupancy[];
  /** Reference-rank span not covered by any phase extent: the GPU waiting on
   * the host between phases. */
  readonly interPhaseMs: number;
  /** Complement of the kernel union inside the span, in span order. */
  readonly gaps: readonly TimeInterval[];
  readonly widestGap: TimeInterval | null;
}

const NS_PER_MS = 1e6;

/** Merge overlapping intervals. Ranks launch concurrently and a kernel may be
 * re-entered, so the input is not sorted or disjoint. */
export function mergeIntervals(intervals: readonly TimeInterval[]): readonly TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((left, right) => left.startNs - right.startNs);
  const merged: TimeInterval[] = [{ ...sorted[0] }];
  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (interval.startNs <= last.endNs) {
      if (interval.endNs > last.endNs)
        merged[merged.length - 1] = { ...last, endNs: interval.endNs };
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** The parts of `[startNs, endNs)` no interval covers. */
export function complementWithin(
  span: TimeInterval,
  covered: readonly TimeInterval[],
): readonly TimeInterval[] {
  const gaps: TimeInterval[] = [];
  let cursor = span.startNs;
  for (const interval of covered) {
    if (interval.startNs > cursor) gaps.push({ startNs: cursor, endNs: interval.startNs });
    cursor = Math.max(cursor, interval.endNs);
  }
  if (cursor < span.endNs) gaps.push({ startNs: cursor, endNs: span.endNs });
  return gaps;
}

const totalNs = (intervals: readonly TimeInterval[]): number =>
  intervals.reduce((sum, interval) => sum + (interval.endNs - interval.startNs), 0);

/** Reference-rank intervals of one iteration, grouped by capture phase. */
export function referenceIntervalsByPhase(
  iteration: AlignmentTimelineIteration,
  referenceDeviceId: number,
): Map<string, TimeInterval[]> {
  const byPhase = new Map<string, TimeInterval[]>();
  for (const kernel of iteration.measured.kernels) {
    for (const [deviceId, startNs, endNs] of kernel.intervals) {
      if (deviceId !== referenceDeviceId) continue;
      const bucket = byPhase.get(kernel.phase);
      if (bucket === undefined) byPhase.set(kernel.phase, [{ startNs, endNs }]);
      else bucket.push({ startNs, endNs });
    }
  }
  return byPhase;
}

export function dutyBreakdown(
  iteration: AlignmentTimelineIteration,
  referenceDeviceId: number,
): DutyBreakdown {
  const span: TimeInterval = {
    startNs: iteration.gpuSpanNs[0],
    endNs: iteration.gpuSpanNs[1],
  };
  const byPhase = referenceIntervalsByPhase(iteration, referenceDeviceId);
  const phases: PhaseOccupancy[] = [];
  const phaseExtents: TimeInterval[] = [];
  for (const [phase, intervals] of byPhase) {
    const merged = mergeIntervals(intervals);
    if (merged.length === 0) continue;
    const extent: TimeInterval = {
      startNs: merged[0].startNs,
      endNs: merged[merged.length - 1].endNs,
    };
    const busyNs = totalNs(merged);
    phaseExtents.push(extent);
    phases.push({
      phase,
      extent,
      busyMs: busyNs / NS_PER_MS,
      idleMs: (extent.endNs - extent.startNs - busyNs) / NS_PER_MS,
    });
  }
  phases.sort((left, right) => left.extent.startNs - right.extent.startNs);

  const allIntervals = mergeIntervals([...byPhase.values()].flat());
  const gaps = complementWithin(span, allIntervals);
  const widestGap = gaps.reduce<TimeInterval | null>(
    (widest, gap) =>
      widest === null || gap.endNs - gap.startNs > widest.endNs - widest.startNs ? gap : widest,
    null,
  );
  const spanNs = span.endNs - span.startNs;
  const busyNs = totalNs(allIntervals);
  // Phase extents can overlap when two phases interleave on the device, so the
  // uncovered remainder is taken against their union rather than their sum.
  const interPhaseNs = spanNs - totalNs(mergeIntervals(phaseExtents));
  return {
    spanMs: spanNs / NS_PER_MS,
    busyMs: busyNs / NS_PER_MS,
    idleMs: (spanNs - busyNs) / NS_PER_MS,
    phases,
    interPhaseMs: Math.max(0, interPhaseNs) / NS_PER_MS,
    gaps,
    widestGap,
  };
}

/**
 * The five parts the span decomposes into, in the order the bar draws them.
 *
 * `forward` is named apart from every other phase because it is the one the
 * model prices: its idle time is the gap the multiplier has to cover, while a
 * `postprocess` bubble is work the model never claimed to schedule. Collapsing
 * them into one "idle" would make the two indistinguishable in the one figure
 * that exists to tell them apart.
 */
export const DUTY_SEGMENTS = [
  { key: 'forwardBusy', label: 'forward · kernels running' },
  { key: 'forwardIdle', label: 'forward · idle' },
  { key: 'otherBusy', label: 'other phases · running' },
  { key: 'otherIdle', label: 'other phases · idle' },
  { key: 'interPhase', label: 'between phases · host' },
] as const;

export type DutySegmentKey = (typeof DUTY_SEGMENTS)[number]['key'];

export interface DutySegment {
  readonly key: DutySegmentKey;
  readonly label: string;
  readonly ms: number;
}

const FORWARD_PHASE = 'forward';

export function dutySegments(breakdown: DutyBreakdown): readonly DutySegment[] {
  const forward = breakdown.phases.filter((phase) => phase.phase === FORWARD_PHASE);
  const others = breakdown.phases.filter((phase) => phase.phase !== FORWARD_PHASE);
  const sum = (phases: readonly PhaseOccupancy[], field: 'busyMs' | 'idleMs'): number =>
    phases.reduce((total, phase) => total + phase[field], 0);
  const milliseconds: Readonly<Record<DutySegmentKey, number>> = {
    forwardBusy: sum(forward, 'busyMs'),
    forwardIdle: sum(forward, 'idleMs'),
    otherBusy: sum(others, 'busyMs'),
    otherIdle: sum(others, 'idleMs'),
    interPhase: breakdown.interPhaseMs,
  };
  return DUTY_SEGMENTS.map((segment) => ({ ...segment, ms: milliseconds[segment.key] }));
}

/** What share of the forward phase's own span no kernel occupied. Null when
 * the capture marked no forward phase, which is not the same as zero idle. */
export function forwardIdleFraction(breakdown: DutyBreakdown): number | null {
  const forward = breakdown.phases.find((phase) => phase.phase === FORWARD_PHASE);
  if (forward === undefined) return null;
  const spanMs = forward.busyMs + forward.idleMs;
  return spanMs > 0 ? forward.idleMs / spanMs : 0;
}

export interface ForwardGap {
  readonly gap: TimeInterval;
  /** The operation of the kernel that closed before the gap, and of the one
   * that opened after it. Null where the labeler tied that kernel to none. */
  readonly fromOperation: string | null;
  readonly toOperation: string | null;
}

/**
 * The widest hole inside the forward phase, and the two operations across it.
 *
 * Named by its edges rather than by its position, because "148 µs at
 * kv_cache_append → attention" is a place in the program a reader can go and
 * look at, while "148 µs at 7.31 ms" is a place in this one capture.
 */
export function widestForwardGap(
  iteration: AlignmentTimelineIteration,
  referenceDeviceId: number,
): ForwardGap | null {
  const runs: { startNs: number; endNs: number; operation: string | null }[] = [];
  for (const kernel of iteration.measured.kernels) {
    if (kernel.phase !== FORWARD_PHASE) continue;
    for (const [deviceId, startNs, endNs] of kernel.intervals) {
      if (deviceId !== referenceDeviceId) continue;
      runs.push({ startNs, endNs, operation: kernel.operation });
    }
  }
  if (runs.length < 2) return null;
  runs.sort((left, right) => left.startNs - right.startNs);
  let widest: ForwardGap | null = null;
  let cursorNs = runs[0].endNs;
  let cursorOperation = runs[0].operation;
  for (const run of runs.slice(1)) {
    const width = run.startNs - cursorNs;
    if (width > 0 && (widest === null || width > widest.gap.endNs - widest.gap.startNs)) {
      widest = {
        gap: { startNs: cursorNs, endNs: run.startNs },
        fromOperation: cursorOperation,
        toOperation: run.operation,
      };
    }
    if (run.endNs > cursorNs) {
      cursorNs = run.endNs;
      cursorOperation = run.operation;
    }
  }
  return widest;
}

/** This iteration's own duty ratio. The capture-wide recommended multiplier is
 * presented in the GPU-cycle-vs-Timing-predict panel, where its scope is clear. */
export function iterationDutyRatio(iteration: AlignmentTimelineIteration): number | null {
  const criticalPathMs = iteration.measured.criticalPathMs;
  const cycleMs = iteration.measuredGpuCycleMs;
  // The last iteration of a capture has no cycle, so it has no duty ratio
  // either; reporting one would divide by a length that was never measured.
  if (cycleMs === null || criticalPathMs <= 0) return null;
  return cycleMs / criticalPathMs;
}
