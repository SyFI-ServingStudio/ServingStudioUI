import { describe, expect, it } from 'vitest';

import type { AlignmentTimelineIterationSummary } from '../../domain/alignment';
import {
  defaultIterationId,
  distinguishedIterations,
  findIteration,
  initialAlignmentIterationId,
  iterationAtSlot,
  neighbourIterationIds,
  orderedIterationIndices,
  stepSelection,
} from './iterationPicker';

function row(
  iterationId: number,
  overrides: Partial<AlignmentTimelineIterationSummary> = {},
): AlignmentTimelineIterationSummary {
  return {
    iterationId,
    caseIndex: iterationId,
    iterationType: 'decode',
    stage: 'decode',
    identitySequence: 'sequence_test',
    selectedAs: 'full_capture',
    anchorNs: 0,
    spanMs: 10,
    busyMs: 8,
    idleMs: 2,
    idleFraction: 0.2,
    gapCount: 3,
    hasHostLane: true,
    measuredMs: 8,
    simulatedMs: 8,
    relativeDiffPct: 0,
    measuredGpuCycleMs: 10,
    simulatedGpuCycleMs: 10,
    ...overrides,
  };
}

const iterations = [
  row(6, { idleFraction: 0.1, relativeDiffPct: -30, selectedAs: 'group_median' }),
  row(7, { idleFraction: 0.5, relativeDiffPct: 4 }),
  row(8, { idleFraction: 0.3, relativeDiffPct: 12, selectedAs: 'global_max_error' }),
];

describe('orderedIterationIndices', () => {
  // Sorted ascending, so both extremes of the capture are at the ends of the
  // picker rather than one of them being buried in the middle.
  it('sorts by idle share, least idle first', () => {
    expect(orderedIterationIndices(iterations, 'idle')).toEqual([0, 2, 1]);
  });

  it('breaks ties by capture position so the picker does not reshuffle', () => {
    const flat = [row(1, { idleFraction: 0.4 }), row(2, { idleFraction: 0.4 })];
    expect(orderedIterationIndices(flat, 'idle')).toEqual([0, 1]);
  });
});

describe('stepSelection', () => {
  const ordered = orderedIterationIndices(iterations, 'run');

  it('steps within the current order', () => {
    expect(stepSelection(ordered, iterations, 7, 1)).toBe(8);
    expect(stepSelection(ordered, iterations, 7, -1)).toBe(6);
  });

  it('clamps at both ends instead of wrapping', () => {
    expect(stepSelection(ordered, iterations, 8, 5)).toBe(8);
    expect(stepSelection(ordered, iterations, 6, -5)).toBe(6);
  });

  it('follows the order in force, not the run order', () => {
    const byIdle = orderedIterationIndices(iterations, 'idle');
    expect(stepSelection(byIdle, iterations, 8, 1)).toBe(7);
  });
});

describe('iterationAtSlot', () => {
  it('resolves a bar position through the current order', () => {
    const byIdle = orderedIterationIndices(iterations, 'idle');
    expect(byIdle[1]).not.toBe(1);
    expect(iterationAtSlot(byIdle, iterations, 1)?.iterationId).toBe(
      iterations[byIdle[1]].iterationId,
    );
  });

  it('clamps an out-of-range slot rather than returning nothing', () => {
    const ordered = orderedIterationIndices(iterations, 'run');
    expect(iterationAtSlot(ordered, iterations, 99)?.iterationId).toBe(8);
  });
});

describe('distinguished iterations', () => {
  it('excludes rows whose only reason for being present is the full capture', () => {
    expect(distinguishedIterations(iterations).map((entry) => entry.iterationId)).toEqual([6, 8]);
  });

  it('falls back to the first iteration when none is distinguished', () => {
    expect(defaultIterationId([row(42)])).toBe(42);
  });

  it('has no default for an empty capture', () => {
    expect(defaultIterationId([])).toBeNull();
  });
});

describe('initial alignment selection', () => {
  it('prefers the middle detail-backed timeline row over a board-only example', () => {
    expect(initialAlignmentIterationId([row(6), row(1025), row(2045)], 1995)).toBe(1025);
  });
});

describe('findIteration', () => {
  it('returns null for an unknown or absent id', () => {
    expect(findIteration(iterations, null)).toBeNull();
    expect(findIteration(iterations, 999)).toBeNull();
    expect(findIteration(iterations, 8)?.selectedAs).toBe('global_max_error');
  });
});

describe('neighbourIterationIds', () => {
  it('names the iterations either side of the selection', () => {
    expect(neighbourIterationIds(iterations, 7)).toEqual({ before: 6, after: 8 });
  });

  it('has no neighbour past either end of the capture', () => {
    expect(neighbourIterationIds(iterations, 6).before).toBeNull();
    expect(neighbourIterationIds(iterations, 8).after).toBeNull();
  });

  // Drawing a non-consecutive iteration as "after" would make the wall clock
  // between the two — the whole point of one shared axis — a fiction.
  it('refuses a neighbour the capture did not record next to the selection', () => {
    const sparse = [row(6), row(9), row(10)];
    expect(neighbourIterationIds(sparse, 9)).toEqual({ before: null, after: 10 });
  });

  it('has no neighbours for a selection that is not in the index', () => {
    expect(neighbourIterationIds(iterations, null)).toEqual({ before: null, after: null });
  });
});
