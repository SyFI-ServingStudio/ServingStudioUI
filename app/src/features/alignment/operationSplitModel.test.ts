import { describe, expect, it } from 'vitest';

import type {
  AlignmentDistribution,
  AlignmentMappedOperation,
  AlignmentOperationStats,
  AlignmentPairedIteration,
} from '../../domain/alignment';
import type { OperationSplitCycle } from './operationSplitCycles';
import {
  CYCLE_PICKER,
  SPLIT_PLOT,
  cumulativeErrorSteps,
  criticalPathMeasuredGroups,
  cycleOperationRows,
  divergingBars,
  foldMeasuredGroups,
  niceTicks,
  phaseSpans,
  pickerGeometry,
  plotGeometry,
  runOperationRows,
  selectableCycles,
  simulatedSlotRows,
  sortOperationRows,
  steppedCycleIndex,
} from './operationSplitModel';
import { operationPalette } from './operationSplitPalette';

const operations: readonly AlignmentMappedOperation[] = [
  {
    operation: 'layer.qkv_projection',
    role: 'column-parallel QKV projection',
    type: 'gemm',
    simulatedSlots: ['unified.attn_block.qkv_proj'],
    measuredRows: 32,
  },
  {
    operation: 'layer.mlp_allreduce',
    role: 'row-parallel MLP all-reduce',
    type: 'collective',
    simulatedSlots: ['unified.mlp_block.tp_allreduce'],
    measuredRows: 32,
  },
  {
    operation: 'layer.attention',
    role: 'paged attention',
    type: 'attention',
    simulatedSlots: ['unified.attn_block.attention'],
    measuredRows: 96,
  },
];

const palette = operationPalette(operations);

function iteration(
  iterationId: number,
  stage: string,
  measuredMs: number,
  simulatedMs: number,
): AlignmentPairedIteration {
  return {
    iterationId,
    caseIndex: iterationId,
    iterationType: stage,
    stage,
    measuredMs,
    simulatedMs,
    deltaMs: simulatedMs - measuredMs,
    relativeDiffPct: ((simulatedMs - measuredMs) / measuredMs) * 100,
    cumulativeDeltaMs: 0,
    cumulativeRelativeDiffPct: 0,
    measuredBusyUnionMs: measuredMs,
    measuredGpuCycleMs: null,
    simulatedGpuCycleMs: null,
    gpuCycleDeltaMs: null,
    gpuCycleRelativeDiffPct: null,
    gpuCycleCumulativeDeltaMs: null,
    gpuCycleCumulativeRelativeDiffPct: null,
  };
}

function measured(
  phase: string,
  operation: string | null,
  durationMs: number,
  calls = 4,
  name = `${operation ?? 'anonymous'}_kernel`,
): OperationSplitCycle['measuredKernels'][number] {
  return { phase, operation, name, durationMs, concurrentHiddenMs: 0, calls };
}

function slot(
  slotIndex: number,
  operation: string | null,
  criticalPathMs: number,
): OperationSplitCycle['simulatedSlots'][number] {
  return {
    slotIndex,
    name: `slot_${slotIndex}`,
    kind: 'single_gemm',
    operation,
    multiplicity: 32,
    criticalPathMs,
  };
}

describe('selectableCycles', () => {
  const capture = [
    iteration(6, 'mixed', 6.8, 6.1),
    iteration(7, 'decode', 2.6, 3.5),
    iteration(8, 'mixed', 10.2, 10.3),
    iteration(9, 'mixed', 6.4, 6.0),
    ...Array.from({ length: 96 }, (_, offset) => iteration(10 + offset, 'decode', 2.7, 3.5)),
  ];

  it('opens with the capture off-stage cycles, then spreads over the rest', () => {
    const cycles = selectableCycles(capture, 10);
    expect(cycles.map((cycle) => cycle.iterationId)).toEqual([
      6, 8, 9, 20, 34, 48, 63, 77, 91, 105,
    ]);
    // Three off-stage plus seven spread, in capture order, and each one still
    // knows where it sits so a document that addresses cycles by position can
    // be asked for exactly these.
    expect(cycles.map((cycle) => cycle.positionInCapture)).toEqual([
      0, 2, 3, 14, 28, 42, 57, 71, 85, 99,
    ]);
    expect(cycles.map((cycle) => cycle.stage).slice(0, 3)).toEqual(['mixed', 'mixed', 'mixed']);
  });

  it('offers every cycle when the capture is smaller than the sample', () => {
    expect(selectableCycles(capture.slice(0, 4), 50)).toHaveLength(4);
    expect(selectableCycles([], 50)).toEqual([]);
  });

  it('always offers the exact cycle selected elsewhere on the page', () => {
    const cycles = selectableCycles(capture, 10, 35);
    expect(cycles).toHaveLength(10);
    expect(cycles.some((cycle) => cycle.iterationId === 35)).toBe(true);
  });

  it('steps and jumps with the keyboard, clamped at both ends', () => {
    expect(steppedCycleIndex(4, 50, 'ArrowRight')).toBe(5);
    expect(steppedCycleIndex(0, 50, 'ArrowLeft')).toBe(0);
    expect(steppedCycleIndex(4, 50, 'End')).toBe(49);
    expect(steppedCycleIndex(4, 50, 'Home')).toBe(0);
    expect(steppedCycleIndex(4, 50, 'PageDown')).toBeNull();
  });
});

describe('the measured lane', () => {
  // Two layers of one body, which is the shape a real cycle arrives in.
  const kernels = [
    measured('preprocess', null, 0.0015, 4, 'copy_indices'),
    measured('preprocess', null, 0.0013, 4, 'fill_zeros'),
    measured('forward', 'layer.qkv_projection', 0.2, 128),
    measured('forward', null, 0.003, 4, 'triton_fused'),
    measured('forward', 'layer.attention', 0.4, 384),
    measured('forward', 'layer.qkv_projection', 0.25, 128),
    measured('forward', null, 0.001, 4, 'triton_fused'),
    measured('forward', 'layer.attention', 0.3, 384),
  ];

  it('folds a repeated layer body into one group per operation', () => {
    const groups = foldMeasuredGroups(kernels);
    expect(groups.map((group) => group.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(groups[2]).toMatchObject({
      operation: 'layer.qkv_projection',
      foldedRows: 2,
      launches: 256,
    });
    expect(groups[2].ms).toBeCloseTo(0.45, 12);
    // Groups keep the order of their first occurrence, not of their size.
    expect(groups.map((group) => group.operation)).toEqual([
      null,
      null,
      'layer.qkv_projection',
      null,
      'layer.attention',
    ]);
    expect(groups.reduce((sum, group) => sum + group.ms, 0)).toBeCloseTo(
      kernels.reduce((sum, kernel) => sum + kernel.durationMs, 0),
      12,
    );
  });

  it('folds unmapped kernels by name, keeping distinct ones apart', () => {
    const groups = foldMeasuredGroups(kernels);
    expect(groups[3]).toMatchObject({ kernelName: 'triton_fused', foldedRows: 2 });
    expect(groups[0].kernelName).toBe('copy_indices');
    expect(groups[1].kernelName).toBe('fill_zeros');
  });

  it('reads phases as spans over the folded lane', () => {
    const spans = phaseSpans(foldMeasuredGroups(kernels));
    expect(spans.map((span) => span.phase)).toEqual(['preprocess', 'forward']);
    expect(spans[0].endMs).toBeCloseTo(0.0028, 12);
    expect(spans[1].startMs).toBeCloseTo(0.0028, 12);
  });

  it('ends exactly at the critical path under rank divergence and stream overlap', () => {
    const cycle: OperationSplitCycle = {
      iterationId: 54,
      stage: 'decode',
      measuredMs: 22,
      additiveMeasuredMs: 25,
      concurrentHiddenMs: 3,
      simulatedMs: 21,
      unmappedMeasuredMs: 4,
      additiveUnmappedMeasuredMs: 5,
      unmappedSimulatedMs: 0,
      measuredKernels: [
        { ...measured('forward', 'op.a', 12), concurrentHiddenMs: 3 },
        measured('forward', 'op.b', 11),
        { ...measured('forward', null, 6, 1, 'unmapped'), concurrentHiddenMs: 1 },
      ],
      simulatedSlots: [],
      operationSummary: [
        {
          operation: 'op.a',
          additiveMeasuredMs: 10,
          measuredMs: 8,
          concurrentHiddenMs: 2,
          simulatedMs: 8,
          deltaMs: 0,
          relativeDiffPct: 0,
        },
        {
          operation: 'op.b',
          additiveMeasuredMs: 10,
          measuredMs: 10,
          concurrentHiddenMs: 0,
          simulatedMs: 10,
          deltaMs: 0,
          relativeDiffPct: 0,
        },
      ],
    };

    const groups = criticalPathMeasuredGroups(cycle);
    expect(groups.map((group) => group.ms)).toEqual([8, 10, 4]);
    expect(groups.reduce((sum, group) => sum + group.ms, 0)).toBe(22);
  });
});

describe('cumulativeErrorSteps', () => {
  it('keeps every positive folded leaf represented by the producer total', () => {
    const rows = simulatedSlotRows([
      slot(0, 'layer.up_gate_projection', 0.4),
      slot(1, 'layer.up_gate_projection', 0),
      slot(2, 'layer.up_gate_projection', 0.2),
    ]);
    expect(rows.map((row) => [row.slotIndex, row.ms])).toEqual([
      [0, 0.4],
      [2, 0.2],
    ]);
  });

  it('ends at the cycle total difference and carries unmatched time as a debt', () => {
    const groups = foldMeasuredGroups([
      measured('forward', 'layer.qkv_projection', 0.4),
      measured('forward', null, 0.1),
      measured('forward', 'layer.attention', 1),
    ]);
    const slots = [slot(0, 'layer.qkv_projection', 0.3), slot(1, 'layer.attention', 0.9)];
    const { baselineMs, edgesMs, levelsMs } = cumulativeErrorSteps(
      groups,
      simulatedSlotRows(slots),
    );
    expect(baselineMs).toBeCloseTo(-0.1, 12);
    expect(edgesMs).toEqual([0, 0.3, 1.2]);
    expect(levelsMs.at(-1)).toBeCloseTo(0.3 + 0.9 - (0.4 + 0.1 + 1), 12);
  });

  it('apportions one operation measured time across its several slots', () => {
    const groups = foldMeasuredGroups([measured('forward', 'layer.attention', 1)]);
    const slots = simulatedSlotRows([
      slot(0, 'layer.attention', 0.25),
      slot(1, 'layer.attention', 0.75),
    ]);
    const { levelsMs } = cumulativeErrorSteps(groups, slots);
    // A quarter of the modelled time takes a quarter of the measured time.
    expect(levelsMs[0]).toBeCloseTo(0.25 - 0.25, 12);
    expect(levelsMs[1]).toBeCloseTo(0, 12);
  });

  it('treats an operation the model never priced as unmatched', () => {
    const groups = foldMeasuredGroups([measured('forward', 'layer.mlp_allreduce', 0.5)]);
    expect(cumulativeErrorSteps(groups, []).baselineMs).toBeCloseTo(-0.5, 12);
  });
});

describe('plotGeometry', () => {
  const groups = foldMeasuredGroups([
    measured('forward', 'layer.qkv_projection', 1),
    measured('forward', 'layer.attention', 3),
  ]);
  const slots = simulatedSlotRows([
    slot(0, 'layer.qkv_projection', 0.5),
    slot(1, 'layer.attention', 1.5),
    slot(2, 'layer.attention', 1.5),
  ]);
  const geometry = plotGeometry(groups, slots, 4, 3.5);

  it('puts both lanes on one scale that starts at the gutter', () => {
    expect(geometry.measured[0].x).toBeCloseTo(SPLIT_PLOT.gutter, 9);
    expect(geometry.simulated[0].x).toBeCloseTo(SPLIT_PLOT.gutter, 9);
    // The longer lane sets the domain, so the shorter one ends short of it.
    const measuredEnd = geometry.measured.at(-1);
    const simulatedEnd = geometry.simulated.at(-1);
    expect(measuredEnd!.x + measuredEnd!.width).toBeGreaterThan(
      simulatedEnd!.x + simulatedEnd!.width,
    );
    expect(geometry.domainMs).toBeCloseTo(4 * 1.03, 9);
  });

  it('labels a segment only when it is wide enough to hold the text', () => {
    expect(geometry.measured.map((segment) => segment.label)).toEqual(['detail', 'detail']);
    const tiny = plotGeometry(
      foldMeasuredGroups([
        measured('forward', 'layer.qkv_projection', 0.01),
        measured('forward', 'layer.attention', 3.99),
      ]),
      [],
      4,
      0,
    );
    expect(tiny.measured[0].label).toBe('none');
  });

  it('fans a measured group out to every slot of the same operation', () => {
    const attention = geometry.ribbons.filter((ribbon) => ribbon.operation === 'layer.attention');
    expect(attention).toHaveLength(2);
    expect(attention[0].topY).toBe(SPLIT_PLOT.measuredY + SPLIT_PLOT.laneHeight);
    expect(attention[0].bottomY).toBe(SPLIT_PLOT.simulatedY);
  });

  it('draws the cumulative curve as held levels, one per slot', () => {
    expect(geometry.cumulative.path).toHaveLength(slots.length * 2 + 1);
    expect(geometry.cumulative.dots).toHaveLength(slots.length);
    expect(geometry.cumulative.totalDeltaMs).toBeCloseTo(-0.5, 12);
  });
});

describe('niceTicks', () => {
  it('returns round values covering the domain', () => {
    expect(niceTicks(0, 6.65, 9)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('returns the single value for an empty domain', () => {
    expect(niceTicks(3, 3, 9)).toEqual([3]);
  });
});

describe('pickerGeometry', () => {
  const cycles = selectableCycles(
    [iteration(6, 'mixed', 1, 1.5), iteration(7, 'decode', 1, 0.9), iteration(8, 'decode', 1, 1.1)],
    3,
  );
  const geometry = pickerGeometry(cycles, 1);

  it('grows a bar up for overprediction and down for underprediction', () => {
    expect(geometry.bars[0].overpredicted).toBe(true);
    expect(geometry.bars[0].y).toBeLessThan(geometry.zeroY);
    expect(geometry.bars[1].overpredicted).toBe(false);
    expect(geometry.bars[1].y).toBeCloseTo(geometry.zeroY, 9);
  });

  it('keeps every bar inside the picker and ticks the selection', () => {
    for (const bar of geometry.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(CYCLE_PICKER.inset);
      expect(bar.x + bar.width).toBeLessThanOrEqual(CYCLE_PICKER.width - CYCLE_PICKER.inset);
      expect(bar.y + bar.height).toBeLessThanOrEqual(CYCLE_PICKER.height);
    }
    expect(geometry.bars[1].ticked).toBe(true);
  });
});

describe('the operation rail', () => {
  const cycle: OperationSplitCycle = {
    iterationId: 9,
    stage: 'mixed',
    measuredMs: 2,
    additiveMeasuredMs: 2,
    concurrentHiddenMs: 0,
    simulatedMs: 2.2,
    unmappedMeasuredMs: 0.1,
    additiveUnmappedMeasuredMs: 0.1,
    unmappedSimulatedMs: 0,
    measuredKernels: [],
    simulatedSlots: [],
    operationSummary: [
      {
        operation: 'layer.qkv_projection',
        additiveMeasuredMs: 0.5,
        measuredMs: 0.5,
        concurrentHiddenMs: 0,
        simulatedMs: 0.4,
        deltaMs: -0.1,
        relativeDiffPct: -20,
      },
      {
        operation: 'layer.attention',
        additiveMeasuredMs: 1,
        measuredMs: 1,
        concurrentHiddenMs: 0,
        simulatedMs: 1.3,
        deltaMs: 0.3,
        relativeDiffPct: 30,
      },
      {
        operation: 'layer.mlp_allreduce',
        additiveMeasuredMs: 0.05,
        measuredMs: 0.05,
        concurrentHiddenMs: 0,
        simulatedMs: 0.14,
        deltaMs: 0.09,
        relativeDiffPct: 180,
      },
    ],
  };

  it('orders by whichever quantity the reader asked for', () => {
    const rows = cycleOperationRows(cycle, palette);
    expect(sortOperationRows(rows, 'delta').map((row) => row.shortName)).toEqual([
      'attention',
      'qkv_projection',
      'mlp_allreduce',
    ]);
    expect(sortOperationRows(rows, 'relative')[0].shortName).toBe('mlp_allreduce');
    expect(sortOperationRows(rows, 'measured')[0].shortName).toBe('attention');
  });

  it('weighs a run row by its whole contribution, not by a typical cycle', () => {
    const rows = runOperationRows(runStats, palette);
    const [loud, quiet] = sortOperationRows(rows, 'delta');
    // The quiet operation is wrong by more per cycle; the loud one is wrong on
    // far more cycles, and that is what the run total is made of.
    expect(loud.shortName).toBe('qkv_projection');
    expect(loud.deltaMs).toBeCloseTo(2000 * 0.01, 9);
    expect(quiet.deltaMs).toBeCloseTo(20 * 0.5, 9);
    expect(loud.pairings).toBe(2000);
  });

  it('centres the diverging bars on zero and shares one scale', () => {
    const rows = sortOperationRows(cycleOperationRows(cycle, palette), 'delta');
    const bars = divergingBars(rows);
    expect(bars[0].overpredicted).toBe(true);
    expect(bars[0].leftPct).toBe(50);
    expect(bars[1].overpredicted).toBe(false);
    expect(bars[1].leftPct + bars[1].widthPct).toBeCloseTo(50, 9);
    expect(bars[0].widthPct).toBeGreaterThan(bars[1].widthPct);
  });
});

function distribution(mean: number): AlignmentDistribution {
  return { n: 1, mean, p50: mean, p90: mean, p99: mean, max: mean, min: mean };
}

function stats(
  operation: string,
  nPaired: number,
  measuredMean: number,
  simulatedMean: number,
): AlignmentOperationStats {
  return {
    operation,
    nPaired,
    missingMeasured: 0,
    missingSimulated: 0,
    measuredMs: distribution(measuredMean),
    simulatedMs: distribution(simulatedMean),
    deltaMs: distribution(simulatedMean - measuredMean),
    relativeDiffPct: distribution(((simulatedMean - measuredMean) / measuredMean) * 100),
    absRelativeErrorPct: distribution(
      Math.abs(((simulatedMean - measuredMean) / measuredMean) * 100),
    ),
  };
}

const runStats: readonly AlignmentOperationStats[] = [
  stats('layer.qkv_projection', 2000, 0.3, 0.31),
  stats('layer.attention', 20, 1, 1.5),
];
