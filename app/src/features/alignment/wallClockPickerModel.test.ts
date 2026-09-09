import { describe, expect, it } from 'vitest';

import type { AlignmentTimelineIterationSummary } from '../../domain/alignment';
import {
  PICKER,
  pickerBars,
  pickerScrollLeft,
  pickerSlotAt,
  pickerTopFraction,
  pickerWidth,
} from './wallClockPickerModel';

function row(
  iterationId: number,
  idleFraction: number,
  iterationType = 'decode',
): AlignmentTimelineIterationSummary {
  return {
    iterationId,
    caseIndex: iterationId,
    iterationType,
    stage: iterationType,
    identitySequence: 'sequence_test',
    selectedAs: 'full_capture',
    anchorNs: 0,
    spanMs: 10,
    busyMs: 10 * (1 - idleFraction),
    idleMs: 10 * idleFraction,
    idleFraction,
    gapCount: 3,
    hasHostLane: true,
    measuredMs: 8,
    simulatedMs: 8,
    relativeDiffPct: 0,
    measuredGpuCycleMs: 10,
    simulatedGpuCycleMs: 10,
  };
}

const iterations = [row(6, 0.1, 'prefill'), row(7, 0.5), row(8, 0.25, 'mixed')];
const ordered = [0, 1, 2];

describe('pickerTopFraction', () => {
  it('falls back to a full scale when nothing was idle at all', () => {
    expect(pickerTopFraction([row(1, 0)])).toBe(1);
  });
});

describe('pickerBars', () => {
  const bars = pickerBars(iterations, ordered, 1, 8);

  it('scales height by idle share and pitches bars by slot', () => {
    expect(bars.map((bar) => bar.x)).toEqual([0, PICKER.pitch, 2 * PICKER.pitch]);
    expect(bars[1].height).toBeCloseTo(PICKER.barsHeight * 0.5, 12);
  });

  it('gives an all-busy iteration a visible sliver rather than nothing', () => {
    expect(pickerBars([row(1, 0)], [0], 1, null)[0].height).toBeGreaterThan(0);
  });

  // The picker re-sorts, so a bar must carry the index of the row it draws, not
  // its position on screen.
  it('keeps each bar pointing at its own row under a different order', () => {
    const byIdle = pickerBars(iterations, [0, 2, 1], 1, 8);
    expect(byIdle.map((bar) => bar.iterationId)).toEqual([6, 8, 7]);
    expect(byIdle[1].selected).toBe(true);
  });
});

describe('pickerSlotAt', () => {
  it('resolves a click to the bar under it', () => {
    expect(pickerSlotAt(PICKER.pitch * 2 + 1, 3)).toBe(2);
  });

  it('clamps a click past the last bar rather than selecting nothing', () => {
    expect(pickerSlotAt(10_000, 3)).toBe(2);
    expect(pickerSlotAt(-40, 3)).toBe(0);
  });
});

describe('pickerScrollLeft', () => {
  it('never scrolls past either end of the capture', () => {
    expect(pickerScrollLeft(1, 600, 2040)).toBe(0);
    expect(pickerScrollLeft(2039, 600, 2040)).toBe(pickerWidth(2040) - 600);
  });
});
