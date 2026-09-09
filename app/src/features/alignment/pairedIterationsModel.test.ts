import { describe, expect, it } from 'vitest';

import type { AlignmentIterationSeries, AlignmentPairedIteration } from '../../domain/alignment';
import {
  PLOT,
  bandAndMean,
  hoverIndexAt,
  iterationToX,
  iterationTypeShare,
  iterationTypeStrip,
  niceTicks,
  pairedLayout,
  pairedSeries,
  panelScale,
  pixelColumns,
  polylines,
  quantile,
  seriesStats,
  viewportNote,
} from './pairedIterationsModel';

function iteration(
  iterationId: number,
  iterationType: string,
  measuredMs: number,
  simulatedMs: number,
): AlignmentPairedIteration {
  const relativeDiffPct = ((simulatedMs - measuredMs) / measuredMs) * 100;
  return {
    iterationId,
    caseIndex: iterationId,
    iterationType,
    stage: iterationType,
    measuredMs,
    measuredKernelSumMs: measuredMs,
    simulatedMs,
    deltaMs: simulatedMs - measuredMs,
    relativeDiffPct,
    cumulativeDeltaMs: simulatedMs - measuredMs,
    cumulativeRelativeDiffPct: relativeDiffPct,
    measuredBusyUnionMs: measuredMs,
    measuredGpuCycleMs: measuredMs * 2,
    simulatedGpuCycleMs: simulatedMs * 2,
    gpuCycleDeltaMs: (simulatedMs - measuredMs) * 2,
    gpuCycleRelativeDiffPct: relativeDiffPct,
    gpuCycleCumulativeDeltaMs: (simulatedMs - measuredMs) * 2,
    gpuCycleCumulativeRelativeDiffPct: relativeDiffPct,
  };
}

const series: AlignmentIterationSeries = {
  definitions: {
    measured_ms: 'replica critical-path sum',
    measured_busy_union_ms: 'physical GPU busy union',
    relative_diff_pct: '(simulated - measured) / measured * 100',
    measured_gpu_cycle_ms: 'next iteration first-kernel start minus this one',
    gpu_cycle_relative_diff_pct: 'scaled prediction against the measured cycle',
  },
  meta: { recommendedGpuTimeMultiplier: 1.25, measuredPhases: ['forward'] },
  iterations: [
    iteration(6, 'prefill', 10, 11),
    iteration(7, 'decode', 2, 2.2),
    iteration(8, 'decode', 4, 3),
    iteration(9, 'mixed', 8, 8),
  ],
  sequences: null,
  sequenceDetail: null,
  breakdownDetail: null,
};

describe('pairedSeries', () => {
  const paired = pairedSeries(series);

  it('names the iteration types in a stable order, not first-seen order', () => {
    expect(paired.typeNames).toEqual(['decode', 'mixed', 'prefill']);
    expect(paired.iterationType).toEqual([2, 0, 0, 1]);
  });

  it('carries all measured time bases without mixing them', () => {
    const distinct = pairedSeries({
      ...series,
      iterations: series.iterations.map((row) => ({
        ...row,
        measuredBusyUnionMs: row.measuredMs! * 0.5,
        measuredKernelSumMs: row.measuredMs! * 3,
      })),
    });
    const [criticalPath, busyUnion, rawKernelSum, cycle] = distinct.families;
    expect(criticalPath.key).toBe('critical_path');
    expect(criticalPath.measured).toEqual([10, 2, 4, 8]);
    expect(busyUnion.key).toBe('busy_union');
    expect(busyUnion.measured).toEqual([5, 1, 2, 4]);
    expect(rawKernelSum.key).toBe('raw_kernel_sum');
    expect(rawKernelSum.measured).toEqual([30, 6, 12, 24]);
    expect(cycle.key).toBe('gpu_cycle');
    expect(cycle.measured).toEqual([20, 4, 8, 16]);
  });

  it('quotes the analyzer for both sides of each family and never paraphrases', () => {
    const [criticalPath, busyUnion, _rawKernelSum, cycle] = paired.families;
    expect(criticalPath.definition).toBe(series.definitions.relative_diff_pct);
    expect(criticalPath.measuredDefinition).toBe(series.definitions.measured_ms);
    expect(busyUnion.measuredDefinition).toBe(series.definitions.measured_busy_union_ms);
    expect(cycle.definition).toBe(series.definitions.gpu_cycle_relative_diff_pct);
    expect(cycle.measuredDefinition).toBe(series.definitions.measured_gpu_cycle_ms);
  });

  it('recomputes error against the selected busy-union baseline', () => {
    const withDifferentUnion = pairedSeries({
      ...series,
      iterations: series.iterations.slice(0, 2).map((row) => ({
        ...row,
        measuredBusyUnionMs: row.measuredMs * 2,
      })),
    });
    const busyUnion = withDifferentUnion.families[1];
    expect(busyUnion.relative[0]).toBeCloseTo(-45, 12);
    expect(busyUnion.relative[1]).toBeCloseTo(-45, 12);
    expect(busyUnion.cumulative[0]).toBeCloseTo(-45, 12);
    expect(busyUnion.cumulative[1]).toBeCloseTo(-45, 12);
  });
});

describe('seriesStats', () => {
  it('ignores absent values rather than reading them as zero', () => {
    const stats = seriesStats([1, null, 3, Number.NaN, 5]);
    expect(stats.n).toBe(3);
    expect(stats.mean).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.last).toBe(5);
  });

  it('reports the absolute p90 over magnitudes, not over signed values', () => {
    const stats = seriesStats([-100, 1, 2, 3]);
    expect(stats.p90).toBeCloseTo(2.7, 6);
    expect(stats.absoluteP90).toBeCloseTo(70.9, 6);
  });

  it('interpolates a quantile between neighbours', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe('niceTicks', () => {
  it('degenerates to the single bound when the range has no span', () => {
    expect(niceTicks(3, 3, 4)).toEqual([3]);
  });
});

describe('pairedLayout', () => {
  const paired = pairedSeries(series);
  const layout = pairedLayout(paired.families[0]);

  it('starts the value panel at zero rather than at the smallest iteration', () => {
    expect(layout.ranges.value[0]).toBeLessThan(0);
    expect(layout.ranges.value[1]).toBeGreaterThan(layout.valueStats.max);
  });

  it('clips the relative panel to a robust window so one outlier cannot flatten it', () => {
    const outlier = pairedSeries({
      ...series,
      iterations: [
        ...Array.from({ length: 200 }, (_value, index) => iteration(index + 6, 'decode', 4, 4.2)),
        iteration(500, 'prefill', 1, 60),
      ],
    });
    const clipped = pairedLayout(outlier.families[0]);
    expect(clipped.relativeStats.max).toBeGreaterThan(1000);
    expect(clipped.ranges.relative[1]).toBeLessThan(clipped.relativeStats.max);
  });

  it('maps a value onto the panel it belongs to', () => {
    const toY = panelScale(layout, 0, 'value');
    const bottom = toY(layout.ranges.value[0]);
    const top = toY(layout.ranges.value[1]);
    expect(bottom).toBeGreaterThan(top);
    const middleValue = (layout.ranges.value[0] + layout.ranges.value[1]) / 2;
    expect(toY(middleValue)).toBeCloseTo((top + bottom) / 2, 6);
    expect(top).toBe(layout.tops[0]);
  });
});

/** Four iterations squeezed onto two columns, so every column holds a min and
 * a max that a per-point line would have to pick between. */
const twoColumnLayout = {
  ...pairedLayout(pairedSeries(series).families[0]),
  plotWidth: 1,
  columnCount: 2,
  dense: true,
};

describe('the dense reduction', () => {
  it('keeps the extent and the mean of each column', () => {
    const cells = pixelColumns([0, 10, 4, 6], twoColumnLayout);
    expect(cells).toEqual([
      { min: 0, max: 10, sum: 10, n: 2 },
      { min: 4, max: 6, sum: 10, n: 2 },
    ]);
  });

  it('closes the band with the minima walked back', () => {
    const cells = [
      { min: 1, max: 3, sum: 4, n: 2 },
      { min: 2, max: 4, sum: 6, n: 2 },
    ];
    const reduced = bandAndMean(cells, (value) => value, null);
    expect(reduced.band).toEqual([
      [PLOT.left, 3],
      [PLOT.left + 1, 4],
      [PLOT.left + 1, 2],
      [PLOT.left, 1],
    ]);
    expect(reduced.mean).toEqual([
      [PLOT.left, 2],
      [PLOT.left + 1, 3],
    ]);
    expect(reduced.clamped).toBe(0);
  });

  it('counts every placement the clip window pulled onto an edge', () => {
    const cells = [{ min: -50, max: 50, sum: 0, n: 2 }];
    const reduced = bandAndMean(cells, (value) => value, [-10, 10]);
    expect(reduced.clamped).toBe(2);
    expect(reduced.band).toEqual([
      [PLOT.left, 10],
      [PLOT.left, -10],
    ]);
  });
});

describe('polylines', () => {
  const layout = pairedLayout(pairedSeries(series).families[0]);

  it('breaks the line at an absent value instead of drawing a chord across it', () => {
    const drawn = polylines([1, null, 3, 4], layout, (value) => value, null);
    expect(drawn.segments).toHaveLength(2);
    expect(drawn.segments[0].points).toHaveLength(1);
    expect(drawn.segments[1].points).toHaveLength(2);
  });

  it('marks and counts the points the clip window moved', () => {
    const drawn = polylines([1, 99, null, 2], layout, (value) => value, [0, 10]);
    expect(drawn.clamped).toBe(1);
    expect(drawn.segments[0].clampedPoints).toEqual([[iterationToX(layout, 1), 10]]);
  });
});

describe('the iteration-type strip', () => {
  const paired = pairedSeries(series);

  it('gives a shared column to the rarest type that lands in it', () => {
    // decode appears twice, the other two once each; both rare types must
    // survive the column they share with a decode.
    const runs = iterationTypeStrip([0, 2, 0, 1], twoColumnLayout);
    expect(runs.map((run) => run.typeIndex)).toEqual([2, 1]);
  });

  it('shares counts, not percentages, most common first', () => {
    expect(iterationTypeShare(paired.iterationType, paired.typeNames)).toBe(
      'decode 2  ·  mixed 1  ·  prefill 1',
    );
  });
});

describe('hoverIndexAt', () => {
  const layout = pairedLayout(pairedSeries(series).families[0]);

  it('names the iteration under the pointer and never one outside the capture', () => {
    expect(hoverIndexAt(layout, PLOT.left / PLOT.width)).toBe(0);
    expect(hoverIndexAt(layout, 0)).toBe(0);
    expect(hoverIndexAt(layout, 1)).toBe(layout.count - 1);
  });
});

describe('a windowed layout', () => {
  const paired = pairedSeries(series);
  const zoomed = pairedLayout(paired.families[0], { start: 1, end: 2 });

  it('puts the ends of the window at the ends of the plot', () => {
    expect(iterationToX(zoomed, 1)).toBeCloseTo(PLOT.left, 9);
    expect(iterationToX(zoomed, 2)).toBeCloseTo(PLOT.width - PLOT.right, 9);
  });

  it('accepts no window the data does not hold', () => {
    const beyond = pairedLayout(paired.families[0], { start: -10, end: 99 });
    expect(beyond.viewport).toEqual({ start: 0, end: 3 });
    expect(beyond.visibleCount).toBe(4);
  });

  it('drops the iterations outside it instead of piling them on the edge', () => {
    // One iteration of margin on each side, so a line enters and leaves the
    // plot rather than starting inside it: a window of 1…2 walks 0…3.
    const drawn = polylines([1, 2, 3, 4], zoomed, (value) => value, null);
    expect(drawn.segments[0].points.map(([, value]) => value)).toEqual([1, 2, 3, 4]);

    const atTheEnd = pairedLayout(paired.families[0], { start: 2, end: 3 });
    const tail = polylines([1, 2, 3, 4], atTheEnd, (value) => value, null);
    expect(tail.segments[0].points.map(([, value]) => value)).toEqual([2, 3, 4]);
    // The band has no use for that margin point — it has no column to land in —
    // so the reduction keeps only what the plot actually covers.
    expect(pixelColumns([1, 2, 3, 4], atTheEnd).filter((cell) => cell !== null)).toHaveLength(2);
  });

  it('reads the pointer against the window, not against the capture', () => {
    expect(hoverIndexAt(zoomed, PLOT.left / PLOT.width)).toBe(1);
    expect(hoverIndexAt(zoomed, 1)).toBe(2);
  });

  it('names the window in the ids the axis prints', () => {
    expect(viewportNote(paired, pairedLayout(paired.families[0]))).toBe(
      'x axis · every one of 4 iterations',
    );
    expect(viewportNote(paired, zoomed)).toBe('x axis · iterations 7 … 8 · 2 of 4');
  });
});
