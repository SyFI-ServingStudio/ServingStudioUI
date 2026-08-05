import { describe, expect, it } from 'vitest';

import type { AlignmentBreakdown } from '../../domain/alignment';
import { cycleFromBreakdown } from './operationSplitCycles';

const breakdown: AlignmentBreakdown = {
  iterationId: 9,
  caseIndex: 3,
  stage: 'mixed',
  measuredKernelSumMs: 6.4541,
  simulatedLeafWorkloadMs: 6.0489,
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
      multiplicity: 32,
    },
  ],
  operationSummary: [
    {
      operation: 'layer.qkv_projection',
      measuredMs: 0.4475,
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
      measuredMs: 6.4541,
      simulatedMs: 6.0489,
    });
    expect(cycle.measuredKernels[0]).toEqual({
      phase: 'forward',
      operation: 'layer.qkv_projection',
      name: 'void gemm_kernel<float>(int)',
      durationMs: 0.4475,
      calls: 128,
    });
    expect(cycle.simulatedSlots[0]).toMatchObject({ foldedMs: 0.4352 });
    expect(cycle.operationSummary[0].relativeDiffPct).toBeCloseTo(-2.75, 9);
  });

  it('preserves a missing phase as an explicit empty grouping key', () => {
    const cycle = cycleFromBreakdown({
      ...breakdown,
      measuredKernels: [{ ...breakdown.measuredKernels[0], phase: null }],
    });
    expect(cycle.measuredKernels[0].phase).toBe('');
  });
});
