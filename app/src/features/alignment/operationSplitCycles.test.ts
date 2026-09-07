import { describe, expect, it } from 'vitest';

import type { AlignmentBreakdown } from '../../domain/alignment';
import { cycleFromBreakdown } from './operationSplitCycles';

const breakdown: AlignmentBreakdown = {
  iterationId: 9,
  caseIndex: 3,
  stage: 'mixed',
  measuredCriticalPathMs: 0.5939,
  measuredKernelSumMs: 0.5939,
  measuredConcurrentHiddenMs: 0,
  // Folded and critical path deliberately differ: the folded sum counts every
  // fan-out child, so a stack drawn from it is a multiple of the modelled cost.
  simulatedLeafWorkloadMs: 6.0489,
  simulatedCriticalPathMs: 0.7561,
  unmappedMeasuredMs: 0.1464,
  unmappedSimulatedMs: 0.0036,
  measuredKernels: [
    {
      rowId: 'sequence_a:1',
      name: 'void gemm_kernel<float>(int)',
      category: 'gemm_or_cutlass',
      phase: 'forward',
      operation: 'layer.qkv_projection',
      durationMs: 0.4475,
      concurrentHiddenMs: 0,
      calls: 128,
      firstStartNs: 12,
      deviceIds: [0, 1],
    },
  ],
  simulatedKernels: [
    {
      slotIndex: 2,
      name: 'unified.attn_block.qkv_proj',
      kind: 'single_gemm',
      operation: 'layer.qkv_projection',
      unitMs: 0.0136,
      foldedMs: 0.4352,
      criticalPathMs: 0.0544,
      multiplicity: 32,
    },
  ],
  operationSummary: [
    {
      operation: 'layer.qkv_projection',
      measuredMs: 0.4475,
      measuredConcurrentHiddenMs: 0,
      simulatedMs: 0.4352,
      deltaMs: -0.0123,
      relativeDiffPct: -2.75,
    },
  ],
  phaseSummary: [],
};

describe('cycleFromBreakdown', () => {
  it('projects the canonical detail without changing timing fields', () => {
    const cycle = cycleFromBreakdown(breakdown);
    expect(cycle).toMatchObject({
      iterationId: 9,
      stage: 'mixed',
      measuredMs: 0.5939,
      additiveMeasuredMs: 0.5939,
      concurrentHiddenMs: 0,
      simulatedMs: 0.7561,
    });
    expect(cycle?.measuredKernels[0]).toEqual({
      phase: 'forward',
      operation: 'layer.qkv_projection',
      name: 'void gemm_kernel<float>(int)',
      durationMs: 0.4475,
      concurrentHiddenMs: 0,
      calls: 128,
    });
    expect(cycle?.simulatedSlots[0]).toMatchObject({ criticalPathMs: 0.0544 });
    expect(cycle?.operationSummary[0].relativeDiffPct).toBeCloseTo(
      ((0.4352 - 0.4475) / 0.4475) * 100,
      9,
    );
  });

  it('uses the analyzer headline instead of reconstructing it from one overlap subset', () => {
    const cycle = cycleFromBreakdown({
      ...breakdown,
      // 25 raw - 3 cross-track - 4 same-track/PDL = 18 critical. The UI must
      // not invent 22 by subtracting only the cross-track field.
      measuredCriticalPathMs: 18,
      measuredKernelSumMs: 25,
      measuredConcurrentHiddenMs: 3,
      unmappedMeasuredMs: 4,
      operationSummary: [
        {
          operation: 'op.a',
          measuredMs: 7,
          measuredConcurrentHiddenMs: 2,
          simulatedMs: 9,
          deltaMs: 2,
          relativeDiffPct: 28.57,
        },
        {
          operation: 'op.b',
          measuredMs: 7,
          measuredConcurrentHiddenMs: 0,
          simulatedMs: 10,
          deltaMs: 3,
          relativeDiffPct: 42.86,
        },
      ],
    });

    expect(cycle?.measuredMs).toBe(18);
    expect(cycle?.unmappedMeasuredMs).toBe(4);
    expect(cycle?.operationSummary.map((row) => row.measuredMs)).toEqual([7, 7]);
    expect(
      (cycle?.operationSummary.reduce((sum, row) => sum + row.measuredMs, 0) ?? 0) +
        (cycle?.unmappedMeasuredMs ?? 0),
    ).toBe(18);
  });

  it('projects nothing when the report carries no critical-path attribution', () => {
    // Reports produced before 2026-08-04 carry the same schema version and no
    // attribution. Falling back to the folded workload would draw a modelled
    // stack several times too tall, so the projection refuses instead.
    const cycle = cycleFromBreakdown({
      ...breakdown,
      simulatedCriticalPathMs: null,
      simulatedKernels: [{ ...breakdown.simulatedKernels[0], criticalPathMs: null }],
    });
    expect(cycle).toBeNull();
  });

  it('preserves a missing phase as an explicit empty grouping key', () => {
    const cycle = cycleFromBreakdown({
      ...breakdown,
      measuredKernels: [{ ...breakdown.measuredKernels[0], phase: null }],
    });
    expect(cycle?.measuredKernels[0].phase).toBe('');
  });
});
