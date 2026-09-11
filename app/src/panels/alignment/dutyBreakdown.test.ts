import { describe, expect, it } from 'vitest';

import type { AlignmentTimelineIteration } from '../../artifacts/schema/alignmentTypes';
import {
  complementWithin,
  dutyBreakdown,
  dutySegments,
  forwardIdleFraction,
  iterationDutyRatio,
  mergeIntervals,
  referenceIntervalsByPhase,
  widestForwardGap,
} from './dutyBreakdown';

const NS_PER_MS = 1e6;

function iteration(
  kernels: readonly {
    phase: string;
    operation?: string | null;
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
        operation: kernel.operation ?? null,
        synchronizing: false,
        occurrenceNs: 0,
        intervals: kernel.intervals,
      })),
    },
    simulated: { totalMs: 7, slotMs: [], slotOperation: [] },
    operationTotals: [],
    host: null,
    ...overrides,
  };
}

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals into one', () => {
    expect(
      mergeIntervals([
        { startNs: 10, endNs: 20 },
        { startNs: 15, endNs: 30 },
        { startNs: 30, endNs: 40 },
      ]),
    ).toEqual([{ startNs: 10, endNs: 40 }]);
  });

  it('keeps disjoint intervals apart and sorts them', () => {
    expect(
      mergeIntervals([
        { startNs: 50, endNs: 60 },
        { startNs: 10, endNs: 20 },
      ]),
    ).toEqual([
      { startNs: 10, endNs: 20 },
      { startNs: 50, endNs: 60 },
    ]);
  });

  it('does not extend a merged interval backwards when a contained one follows', () => {
    expect(
      mergeIntervals([
        { startNs: 0, endNs: 100 },
        { startNs: 10, endNs: 20 },
      ]),
    ).toEqual([{ startNs: 0, endNs: 100 }]);
  });
});

describe('complementWithin', () => {
  it('reports the uncovered parts of the span, including both edges', () => {
    expect(
      complementWithin({ startNs: 0, endNs: 100 }, [
        { startNs: 10, endNs: 20 },
        { startNs: 40, endNs: 90 },
      ]),
    ).toEqual([
      { startNs: 0, endNs: 10 },
      { startNs: 20, endNs: 40 },
      { startNs: 90, endNs: 100 },
    ]);
  });

  it('reports the whole span when nothing covers it', () => {
    expect(complementWithin({ startNs: 5, endNs: 9 }, [])).toEqual([{ startNs: 5, endNs: 9 }]);
  });
});

describe('referenceIntervalsByPhase', () => {
  it('keeps only the reference rank, so a slower peer cannot fill this rank`s gaps', () => {
    const byPhase = referenceIntervalsByPhase(
      iteration([
        {
          phase: 'forward',
          intervals: [
            [0, 0, NS_PER_MS],
            [1, 0, 5 * NS_PER_MS],
          ],
        },
      ]),
      0,
    );
    expect(byPhase.get('forward')).toEqual([{ startNs: 0, endNs: NS_PER_MS }]);
  });
});

describe('dutyBreakdown', () => {
  const subject = iteration([
    { phase: 'preprocess', intervals: [[0, 0, 1 * NS_PER_MS]] },
    {
      phase: 'forward',
      intervals: [
        [0, 3 * NS_PER_MS, 5 * NS_PER_MS],
        [0, 6 * NS_PER_MS, 8 * NS_PER_MS],
      ],
    },
  ]);

  it('splits busy from idle over the reference rank span', () => {
    const breakdown = dutyBreakdown(subject, 0);
    expect(breakdown.spanMs).toBe(10);
    expect(breakdown.busyMs).toBe(5);
    expect(breakdown.idleMs).toBe(5);
  });

  it('separates a phase`s internal idle from the time between phases', () => {
    const breakdown = dutyBreakdown(subject, 0);
    const forward = breakdown.phases.find((phase) => phase.phase === 'forward');
    expect(forward?.busyMs).toBe(4);
    // 3 ms to 8 ms extent, 4 ms of it running.
    expect(forward?.idleMs).toBe(1);
    // 1 ms to 3 ms plus 8 ms to 10 ms, neither inside a phase extent.
    expect(breakdown.interPhaseMs).toBe(4);
  });

  it('orders phases by when they started, not by name', () => {
    expect(dutyBreakdown(subject, 0).phases.map((phase) => phase.phase)).toEqual([
      'preprocess',
      'forward',
    ]);
  });

  it('reports gaps from the raw intervals, widest first identified', () => {
    const breakdown = dutyBreakdown(subject, 0);
    expect(breakdown.gaps).toEqual([
      { startNs: 1 * NS_PER_MS, endNs: 3 * NS_PER_MS },
      { startNs: 5 * NS_PER_MS, endNs: 6 * NS_PER_MS },
      { startNs: 8 * NS_PER_MS, endNs: 10 * NS_PER_MS },
    ]);
    expect(breakdown.widestGap).toEqual({ startNs: 1 * NS_PER_MS, endNs: 3 * NS_PER_MS });
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

describe('dutySegments', () => {
  const subject = iteration([
    { phase: 'preprocess', intervals: [[0, 0, 1 * NS_PER_MS]] },
    {
      phase: 'forward',
      intervals: [
        [0, 3 * NS_PER_MS, 5 * NS_PER_MS],
        [0, 6 * NS_PER_MS, 8 * NS_PER_MS],
      ],
    },
  ]);

  // The forward phase is the one the model prices, so its idle is the gap the
  // multiplier has to cover; a postprocess bubble is work never claimed.
  it('names the forward phase apart from every other one', () => {
    const segments = dutySegments(dutyBreakdown(subject, 0));
    expect(segments.map((segment) => [segment.key, segment.ms])).toEqual([
      ['forwardBusy', 4],
      ['forwardIdle', 1],
      ['otherBusy', 1],
      ['otherIdle', 0],
      ['interPhase', 4],
    ]);
  });

  it('reports the forward phase`s own idle share, not the iteration`s', () => {
    // 1 ms idle inside a 5 ms forward extent, against 5 ms idle in a 10 ms span.
    expect(forwardIdleFraction(dutyBreakdown(subject, 0))).toBeCloseTo(0.2, 12);
  });

  it('has no forward idle share for a capture that marked no forward phase', () => {
    const noForward = iteration([{ phase: 'preprocess', intervals: [[0, 0, NS_PER_MS]] }]);
    expect(forwardIdleFraction(dutyBreakdown(noForward, 0))).toBeNull();
  });
});

describe('widestForwardGap', () => {
  const subject = iteration([
    { phase: 'preprocess', operation: 'layer.embedding', intervals: [[0, 0, 1 * NS_PER_MS]] },
    {
      phase: 'forward',
      operation: 'layer.kv_cache_append',
      intervals: [[0, 2 * NS_PER_MS, 3 * NS_PER_MS]],
    },
    {
      phase: 'forward',
      operation: 'layer.attention',
      intervals: [[0, 5 * NS_PER_MS, 6 * NS_PER_MS]],
    },
    {
      phase: 'forward',
      operation: 'layer.down_projection',
      intervals: [[0, 6.5 * NS_PER_MS, 7 * NS_PER_MS]],
    },
  ]);

  it('names the gap by the operations across it, not by its position', () => {
    const gap = widestForwardGap(subject, 0)!;
    expect(gap.gap).toEqual({ startNs: 3 * NS_PER_MS, endNs: 5 * NS_PER_MS });
    expect([gap.fromOperation, gap.toOperation]).toEqual([
      'layer.kv_cache_append',
      'layer.attention',
    ]);
  });

  it('is null when the phase has fewer than two runs to gap between', () => {
    const single = iteration([{ phase: 'forward', intervals: [[0, 0, NS_PER_MS]] }]);
    expect(widestForwardGap(single, 0)).toBeNull();
  });

  it('keeps only the reference rank, so a peer`s kernel cannot close this gap', () => {
    const peerFilled = iteration([
      { phase: 'forward', operation: 'layer.attention', intervals: [[0, 0, NS_PER_MS]] },
      {
        phase: 'forward',
        operation: 'layer.attention',
        intervals: [[1, NS_PER_MS, 4 * NS_PER_MS]],
      },
      {
        phase: 'forward',
        operation: 'layer.qkv_projection',
        intervals: [[0, 4 * NS_PER_MS, 5 * NS_PER_MS]],
      },
    ]);
    expect(widestForwardGap(peerFilled, 0)?.gap).toEqual({
      startNs: NS_PER_MS,
      endNs: 4 * NS_PER_MS,
    });
  });
});
