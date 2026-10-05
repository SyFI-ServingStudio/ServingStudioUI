import type {
  AlignmentReferenceRank,
  AlignmentTimeInterval,
  AlignmentTimelineIteration,
} from '../../artifacts/schema/alignmentTypes';

/**
 * Where one iteration's wall clock went on the reference rank.
 *
 * The numbers are the Analyzer's: each timeline detail row carries the
 * reference rank's occupancy (`referenceRank`) — span, kernel time and bubble
 * per phase, the host time between phases, every gap's extent, and the widest
 * gaps with the kernels on either side. This module only arranges them for the
 * card.
 *
 * The split is phase-wise because that is the only boundary the capture
 * actually marks: within a phase the GPU is either running a kernel or idle,
 * and between phases it is waiting on the host.
 */

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

export function dutySegments(rank: AlignmentReferenceRank): readonly DutySegment[] {
  const forward = rank.phases.filter((phase) => phase.phase === FORWARD_PHASE);
  const others = rank.phases.filter((phase) => phase.phase !== FORWARD_PHASE);
  const sum = (phases: typeof rank.phases, field: 'busyMs' | 'idleMs'): number =>
    phases.reduce((total, phase) => total + phase[field], 0);
  const milliseconds: Readonly<Record<DutySegmentKey, number>> = {
    forwardBusy: sum(forward, 'busyMs'),
    forwardIdle: sum(forward, 'idleMs'),
    otherBusy: sum(others, 'busyMs'),
    otherIdle: sum(others, 'idleMs'),
    interPhase: rank.interPhaseMs,
  };
  return DUTY_SEGMENTS.map((segment) => ({ ...segment, ms: milliseconds[segment.key] }));
}

/** What share of the forward phase's own span no kernel occupied. Null when
 * the capture marked no forward phase, which is not the same as zero idle. */
export function forwardIdleFraction(rank: AlignmentReferenceRank): number | null {
  const forward = rank.phases.find((phase) => phase.phase === FORWARD_PHASE);
  if (forward === undefined) return null;
  return forward.idleFraction ?? 0;
}

export interface ForwardGap {
  readonly gap: AlignmentTimeInterval;
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
export function widestForwardGap(rank: AlignmentReferenceRank): ForwardGap | null {
  const widest = rank.phases.find((phase) => phase.phase === FORWARD_PHASE)?.largestGaps[0];
  if (widest === undefined) return null;
  return {
    gap: { startNs: widest.startNs, endNs: widest.startNs + widest.durationUs * 1e3 },
    fromOperation: widest.afterOperation,
    toOperation: widest.beforeOperation,
  };
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
