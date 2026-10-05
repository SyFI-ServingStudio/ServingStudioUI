import { describe, expect, it } from 'vitest';

import type {
  AlignmentReferenceRank,
  AlignmentTimelineIteration,
} from '../../artifacts/schema/alignmentTypes';
import {
  dutySegments,
  forwardIdleFraction,
  iterationDutyRatio,
  widestForwardGap,
} from './dutyBreakdown';

const NS_PER_MS = 1e6;

function iteration(
  kernels: readonly {
    phase: string;
    intervals: readonly (readonly [number, number, number])[];
  }[],
  overrides: Partial<AlignmentTimelineIteration> = {},
): AlignmentTimelineIteration {
  return {
    iterationId: 1,
    caseIndex: 0,
    iterationType: 'decode',
    stage: 'decode',
    identitySequence: 'sequence_test',
    selectedAs: 'full_capture',
    anchorNs: 0,
    gpuSpanNs: [0, 10 * NS_PER_MS],
    measuredGpuCycleMs: 12,
    simulatedGpuCycleMs: 11,
    measured: {
      criticalPathMs: 8,
      busyUnionMs: 8,
      kernels: kernels.map((kernel, index) => ({
        nameId: index,
        rowId: `sequence_test:${index}`,
        category: 'other',
        phase: kernel.phase,
        operation: null,
        synchronizing: false,
        occurrenceNs: 0,
        intervals: kernel.intervals,
      })),
    },
    simulated: { totalMs: 7, slotMs: [], slotOperation: [] },
    operationTotals: [],
    host: null,
    referenceRank: RANK,
    ...overrides,
  };
}

const edge = (phase: string, operation: string | null) => ({ phase, operation, kernel: 'k' });

// As the Analyzer reports a 10 ms span: preprocess 0-1 ms, forward 3-8 ms
// with 4 ms of kernels, the rest host time between phases.
const RANK: AlignmentReferenceRank = {
  deviceId: 0,
  spanMs: 10,
  busyMs: 5,
  idleMs: 5,
  idleFraction: 0.5,
  gapCount: 3,
  gaps: [
    { startNs: 1 * NS_PER_MS, endNs: 3 * NS_PER_MS },
    { startNs: 5 * NS_PER_MS, endNs: 6 * NS_PER_MS },
    { startNs: 8 * NS_PER_MS, endNs: 10 * NS_PER_MS },
  ],
  interPhaseMs: 4,
  phases: [
    { phase: 'preprocess', spanMs: 1, busyMs: 1, idleMs: 0, idleFraction: 0, largestGaps: [] },
    {
      phase: 'forward',
      spanMs: 5,
      busyMs: 4,
      idleMs: 1,
      idleFraction: 0.2,
      largestGaps: [
        {
          startNs: 5 * NS_PER_MS,
          durationUs: 1000,
          after: edge('forward', 'layer.kv_cache_append'),
          before: edge('forward', 'layer.attention'),
        },
      ],
    },
  ],
};

describe('dutySegments', () => {
  // The forward phase is the one the model prices, so its idle is the gap the
  // multiplier has to cover; a postprocess bubble is work never claimed.
  it('names the forward phase apart from every other one, in the Analyzer`s numbers', () => {
    expect(dutySegments(RANK).map((segment) => [segment.key, segment.ms])).toEqual([
      ['forwardBusy', 4],
      ['forwardIdle', 1],
      ['otherBusy', 1],
      ['otherIdle', 0],
      ['interPhase', 4],
    ]);
  });

  it('reports the forward phase`s own idle share, not the iteration`s', () => {
    expect(forwardIdleFraction(RANK)).toBe(0.2);
  });

  it('has no forward idle share for a capture that marked no forward phase', () => {
    expect(forwardIdleFraction({ ...RANK, phases: [RANK.phases[0]] })).toBeNull();
  });
});

describe('widestForwardGap', () => {
  it('names the Analyzer`s widest forward gap by the operations across it', () => {
    expect(widestForwardGap(RANK)).toEqual({
      gap: { startNs: 5 * NS_PER_MS, endNs: 6 * NS_PER_MS },
      fromOperation: 'layer.kv_cache_append',
      toOperation: 'layer.attention',
    });
  });

  it('is null when the forward phase recorded no gap', () => {
    const [preprocess, forward] = RANK.phases;
    expect(
      widestForwardGap({ ...RANK, phases: [preprocess, { ...forward, largestGaps: [] }] }),
    ).toBeNull();
  });
});

describe('iterationDutyRatio', () => {
  it('is the gpu cycle over the kernel critical path', () => {
    expect(iterationDutyRatio(iteration([]))).toBeCloseTo(12 / 8, 12);
  });

  it('is null on the last iteration, whose cycle was never closed', () => {
    expect(iterationDutyRatio(iteration([], { measuredGpuCycleMs: null }))).toBeNull();
  });

  it('is null rather than infinite when nothing ran', () => {
    expect(
      iterationDutyRatio(
        iteration([], { measured: { criticalPathMs: 0, busyUnionMs: 0, kernels: [] } }),
      ),
    ).toBeNull();
  });
});
