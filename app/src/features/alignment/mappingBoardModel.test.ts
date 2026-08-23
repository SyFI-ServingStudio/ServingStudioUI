import { describe, expect, it } from 'vitest';

import type {
  AlignmentBreakdown,
  AlignmentIterationReport,
  AlignmentKernelRow,
  AlignmentOperationStats,
  AlignmentSequenceKernel,
  AlignmentSequences,
} from '../../domain/alignment';
import { tokens } from '../../theme';
import {
  boardCoverage,
  boardJoins,
  boardLanes,
  boardSequenceCatalog,
  defaultBoardExampleIterationId,
  defaultSequenceKeys,
  sequenceKeysForIteration,
  sequenceOptionsForPhase,
  SEQUENCES_OFFERED_PER_PHASE,
  UNCLAIMED_SLOT_LABEL,
  UNMAPPED_KERNEL_LABEL,
} from './mappingBoardModel';

function kernel(
  name: string,
  suggestedCategory: string,
  label: AlignmentSequenceKernel['label'],
): AlignmentSequenceKernel {
  return { name, suggestedCategory, label };
}

const QKV = kernel('nvjet', 'gemm_or_cutlass', {
  status: 'mapped',
  crossRank: 'independent',
  operation: 'layer.qkv_projection',
  role: 'column-parallel QKV projection',
  type: 'gemm',
  simulatedSlots: ['unified.attn_block.qkv_proj'],
});
const FUSED = kernel('allreduce_fusion', 'multimem_all_reduce', {
  status: 'mapped',
  crossRank: 'synchronizing',
  operation: 'model.mlp_allreduce_and_norm_boundaries',
  role: 'all MLP all-reduces plus boundary norms',
  type: 'collective_norm',
  simulatedSlots: ['unified.mlp_block.tp_allreduce', 'unified.final_norm'],
});
const EMBED = kernel('embed', 'other', { status: 'unmapped', crossRank: 'independent' });

/** Phase key order is the labeler's, which is the order the phases run in. */
const sequences: AlignmentSequences = {
  encoding: 'folded-v1',
  foldingPolicy: {},
  representativeDeviceId: 0,
  deviceIds: [0, 1],
  phases: {
    preprocess: [
      {
        sequenceId: 'sequence_pre',
        expandedKernelCount: 1,
        iterations: [1, 2, 3, 4],
        occurrences: [],
        totalMs: null,
        tracks: [
          {
            trackIndex: 0,
            streamRole: 'primary',
            kernelCount: 1,
            program: [{ repeat: 1, kernels: [EMBED] }],
          },
        ],
      },
    ],
    forward: [
      {
        sequenceId: 'sequence_cheap',
        expandedKernelCount: 1,
        iterations: [4],
        occurrences: [],
        totalMs: null,
        tracks: [
          {
            trackIndex: 0,
            streamRole: 'primary',
            kernelCount: 1,
            program: [{ repeat: 1, kernels: [QKV] }],
          },
        ],
      },
      {
        sequenceId: 'sequence_big',
        expandedKernelCount: 7,
        iterations: [1, 2, 3],
        occurrences: [],
        totalMs: null,
        tracks: [
          {
            trackIndex: 0,
            streamRole: 'primary',
            kernelCount: 7,
            program: [
              { repeat: 1, kernels: [EMBED] },
              { repeat: 3, kernels: [QKV, FUSED] },
            ],
          },
        ],
      },
    ],
    empty: [],
  },
};

const exampleBreakdown: AlignmentBreakdown = {
  iterationId: 8,
  caseIndex: 0,
  stage: 'mixed',
  measuredKernelSumMs: 10,
  measuredConcurrentHiddenMs: 0,
  simulatedLeafWorkloadMs: 11,
  simulatedCriticalPathMs: 11,
  unmappedMeasuredMs: 0,
  unmappedSimulatedMs: 0,
  measuredKernels: [],
  simulatedKernels: [
    {
      slotIndex: 1,
      name: 'unified.mlp_block.tp_allreduce',
      kind: 'all_reduce',
      operation: 'layer.mlp_allreduce',
      unitMs: 0.5,
      foldedMs: 0.5,
      criticalPathMs: 0.5,
      multiplicity: 1,
    },
    {
      slotIndex: 2,
      name: 'unified.mlp_block.tp_allreduce',
      kind: 'all_reduce',
      operation: 'layer.mlp_allreduce',
      unitMs: 0.5,
      foldedMs: 0.5,
      criticalPathMs: 0.5,
      multiplicity: 1,
    },
    {
      slotIndex: 3,
      name: 'unified.attn_block.qkv_proj',
      kind: 'single_gemm',
      operation: 'layer.qkv_projection',
      unitMs: 0.5,
      foldedMs: 0.5,
      criticalPathMs: 0.5,
      multiplicity: 1,
    },
    {
      slotIndex: 4,
      name: 'unified.final_norm',
      kind: 'rms_norm',
      operation: 'model.mlp_allreduce_and_norm_boundaries',
      unitMs: 0,
      foldedMs: 0,
      criticalPathMs: 0,
      multiplicity: 1,
    },
  ],
  operationSummary: [],
  phaseSummary: [],
};

const exampleMeasuredBreakdown: AlignmentBreakdown = {
  ...exampleBreakdown,
  measuredKernels: [
    {
      rowId: 'sequence_big:2',
      name: 'nvjet',
      category: 'gemm_or_cutlass',
      phase: 'forward',
      operation: 'layer.qkv_projection',
      durationMs: 0.2,
      concurrentHiddenMs: 0,
      calls: 2,
      firstStartNs: 0,
      deviceIds: [0, 1],
    },
    {
      rowId: 'sequence_big:4',
      name: 'nvjet',
      category: 'gemm_or_cutlass',
      phase: 'forward',
      operation: 'layer.qkv_projection',
      durationMs: 0.4,
      concurrentHiddenMs: 0,
      calls: 4,
      firstStartNs: 0,
      deviceIds: [0, 1],
    },
    {
      rowId: 'sequence_big:6',
      name: 'nvjet',
      category: 'gemm_or_cutlass',
      phase: 'forward',
      operation: 'layer.qkv_projection',
      durationMs: 0.6,
      concurrentHiddenMs: 0,
      calls: 8,
      firstStartNs: 0,
      deviceIds: [0, 1],
    },
  ],
};

function row(rowId: string, name: string, category: string, totalMs: number): AlignmentKernelRow {
  return {
    rowId,
    name,
    category,
    phase: 'forward',
    operation: null,
    totalMs,
    meanCallUs: 1,
    calls: 1,
    callsPerIteration: 1,
    replicaCalls: 1,
    replicaCallsPerIteration: 1,
    rankLaunches: 1,
    iterations: 3,
    deviceIds: [0],
  };
}

const distribution = (mean: number) => ({
  n: 3,
  mean,
  p50: mean,
  p90: mean,
  p99: mean,
  max: mean,
  min: 0,
});

function stats(operation: string, mean: number, nPaired: number): AlignmentOperationStats {
  return {
    operation,
    nPaired,
    missingMeasured: 0,
    missingSimulated: 0,
    measuredMs: distribution(mean),
    simulatedMs: distribution(mean),
    deltaMs: distribution(0),
    relativeDiffPct: distribution(0),
    absRelativeErrorPct: distribution(0),
  };
}

const report: AlignmentIterationReport = {
  available: true,
  definitions: {},
  meta: {
    iterations: 4,
    recommendedGpuTimeMultiplier: 1.3,
    representativeDeviceId: 0,
    measuredDeviceIds: [0, 1],
    measuredPhases: ['forward', 'preprocess'],
  },
  iterations: [],
  kernels: [
    row('sequence_pre:1', 'embed', 'other', 1.2),
    row('sequence_cheap:1', 'nvjet', 'gemm_or_cutlass', 0.03),
    row('sequence_big:1', 'embed', 'other', 0.9),
    // The 3× band, body first: ordinals 2,3 then 4,5 then 6,7.
    row('sequence_big:2', 'nvjet', 'gemm_or_cutlass', 1),
    row('sequence_big:3', 'allreduce_fusion', 'multimem_all_reduce', 0.5),
    row('sequence_big:4', 'nvjet', 'gemm_or_cutlass', 2),
    row('sequence_big:5', 'allreduce_fusion', 'multimem_all_reduce', 0.5),
    row('sequence_big:6', 'nvjet', 'gemm_or_cutlass', 3),
    row('sequence_big:7', 'allreduce_fusion', 'multimem_all_reduce', 0.5),
  ],
  mapping: {
    configured: true,
    coverage: {
      measuredDurationFraction: 0.9588,
      measuredMappedMs: 8472,
      measuredTotalKernelMs: 8836,
      simulatedWorkloadFraction: 0.9995,
      simulatedMappedMs: 9348,
      simulatedTotalLeafWorkloadMs: 40,
    },
    operations: [
      {
        operation: 'layer.qkv_projection',
        role: 'column-parallel QKV projection',
        type: 'gemm',
        simulatedSlots: ['unified.attn_block.qkv_proj'],
        measuredRows: 3,
      },
      {
        operation: 'model.mlp_allreduce_and_norm_boundaries',
        role: 'all MLP all-reduces plus boundary norms',
        type: 'collective_norm',
        simulatedSlots: ['unified.mlp_block.tp_allreduce', 'unified.final_norm'],
        measuredRows: 3,
      },
      {
        operation: 'layer.mlp_allreduce',
        role: 'row-parallel MLP all-reduce',
        type: 'collective',
        simulatedSlots: ['unified.mlp_block.tp_allreduce'],
        measuredRows: 3,
      },
    ],
    unmappedMeasuredKernelCount: 1,
    unmappedMeasuredKernels: [
      {
        rowId: 'sequence_big:1',
        name: 'embed',
        phase: 'forward',
        totalMs: 0.9,
        calls: 8,
        deviceIds: [0],
      },
    ],
    unmappedSimulatedSlots: [{ slot: 'unified.embedding', totalMs: 8 }],
  },
  operations: [
    stats('layer.qkv_projection', 0.5, 4),
    stats('model.mlp_allreduce_and_norm_boundaries', 0.4, 4),
    stats('layer.mlp_allreduce', 0.6, 4),
    stats('layer.partial', 0.9, 2),
  ],
  totalIteration: {
    deltaMs: distribution(0),
    relativeDiffPct: distribution(0),
    absRelativeErrorPct: { ...distribution(0), min: null },
  },
};

describe('boardSequenceCatalog', () => {
  const catalog = boardSequenceCatalog(sequences, report);

  it('keeps the phases in the order the labeler wrote them and drops empty ones', () => {
    expect(catalog.phaseOrder).toEqual(['preprocess', 'forward']);
  });

  it('ranks a phase by whole-capture cost, not by how often a program ran', () => {
    const forward = catalog.offered.filter((entry) => entry.phase === 'forward');
    // sequence_big costs 0.9 + (1+2+3) + (0.5*3) = 8.4 over three occurrences;
    // sequence_cheap costs 0.03 over one, and ran later.
    expect(forward.map((entry) => entry.sequenceId)).toEqual(['sequence_big', 'sequence_cheap']);
    expect(forward[0].runMs).toBeCloseTo(8.4, 9);
  });

  it('totals a phase over every program, offered or not', () => {
    expect(catalog.phaseMs.forward).toBeCloseTo(8.43, 9);
    expect(catalog.phaseMs.preprocess).toBeCloseTo(1.2, 9);
  });

  it('offers a bounded number per phase and reports the rest', () => {
    const crowded: AlignmentSequences = {
      ...sequences,
      phases: {
        forward: Array.from({ length: SEQUENCES_OFFERED_PER_PHASE + 2 }, (_unused, index) => ({
          sequenceId: `sequence_${index}`,
          expandedKernelCount: 1,
          iterations: [index],
          occurrences: [],
          totalMs: null,
          tracks: [
            {
              trackIndex: 0,
              streamRole: 'primary',
              kernelCount: 1,
              program: [{ repeat: 1, kernels: [QKV] }],
            },
          ],
        })),
      },
    };
    const bounded = boardSequenceCatalog(crowded, report);
    expect(bounded.offered).toHaveLength(SEQUENCES_OFFERED_PER_PHASE);
    expect(bounded.omittedSequences).toBe(2);

    const omittedIteration = SEQUENCES_OFFERED_PER_PHASE + 1;
    const chosenKey = sequenceKeysForIteration(crowded, bounded, omittedIteration).forward;
    expect(chosenKey).toBe(`forward/sequence_${omittedIteration}`);
    expect(sequenceOptionsForPhase(bounded, 'forward', chosenKey)[0]?.key).toBe(chosenKey);
  });

  it('shortens a sequence id the way the board labels it', () => {
    expect(catalog.offered[0].shortId).toBe('pre');
  });

  it('opens each phase on its costliest program', () => {
    expect(defaultSequenceKeys(catalog)).toEqual({
      preprocess: 'preprocess/sequence_pre',
      forward: 'forward/sequence_big',
    });
  });
});

describe('defaultBoardExampleIterationId', () => {
  it('chooses the middle iteration of the board default program', () => {
    expect(defaultBoardExampleIterationId(sequences, report)).toBe(2);
  });
});

describe('boardLanes measured side', () => {
  const catalog = boardSequenceCatalog(sequences, report);
  const lanes = boardLanes(sequences, report, defaultSequenceKeys(catalog), catalog, null);

  it('shows one card per folded position, not per expanded ordinal', () => {
    expect(lanes.measured.map((card) => card.name)).toEqual([
      'embed',
      'embed',
      'nvjet',
      'allreduce_fusion',
    ]);
    expect(lanes.measured.map((card) => card.repeat)).toEqual([1, 1, 3, 3]);
  });

  it('does not substitute a whole-capture average while iteration detail is unavailable', () => {
    expect(lanes.measured.every((card) => card.ms === null)).toBe(true);
  });

  it('names an unmapped position rather than leaving it blank', () => {
    expect(lanes.measured[0].operationLabel).toBe(UNMAPPED_KERNEL_LABEL);
    expect(lanes.measured[0].mapped).toBe(false);
    expect(lanes.measured[2].operationLabel).toBe('layer.qkv_projection');
  });

  it('gives each operation pair one rotating colour without parsing its name', () => {
    expect(lanes.measured[2].color).toBe(tokens.operationColorPanel[0]);
    expect(lanes.measured[2].color).toBe(lanes.modelled[0].color);
    expect(lanes.measured[3].color).toBe(lanes.modelled[1].color);
    expect(lanes.measured[2].color).not.toBe(lanes.measured[3].color);
  });

  it('groups by phase and names the program each group shows', () => {
    expect(lanes.measuredGroups.map((group) => group.label)).toEqual(['preprocess', 'forward']);
    expect(lanes.measuredGroups[0].note).toBe('pre ×4');
    expect(lanes.measuredGroups[1]).toMatchObject({ from: 1, to: 4 });
  });

  it('keeps concurrent sequence tracks as separate measured groups', () => {
    const detail = {
      ...(sequences.phases.forward[1] ?? sequences.phases.forward[0]),
      sequenceId: 'sequence_big',
      expandedKernelCount: 2,
      tracks: [
        {
          trackIndex: 0,
          streamRole: 'primary',
          kernelCount: 1,
          program: [{ repeat: 1, kernels: [EMBED] }],
        },
        {
          trackIndex: 1,
          streamRole: 'concurrent',
          kernelCount: 1,
          program: [{ repeat: 1, kernels: [QKV] }],
        },
      ],
    };
    const tracked = boardLanes(sequences, report, defaultSequenceKeys(catalog), catalog, null, {
      'forward/sequence_big': detail,
    });
    expect(tracked.measuredGroups.map((group) => group.label)).toEqual([
      'preprocess',
      'forward · stream 0',
      'forward · stream 1',
    ]);
  });
});

describe('boardLanes modelled side', () => {
  const catalog = boardSequenceCatalog(sequences, report);
  const lanes = boardLanes(sequences, report, defaultSequenceKeys(catalog), catalog, null);

  it('orders slots by where the measured program first reaches them', () => {
    expect(lanes.modelled.map((card) => card.slot)).toEqual([
      'unified.attn_block.qkv_proj',
      'unified.mlp_block.tp_allreduce',
      'unified.final_norm',
      'unified.embedding',
    ]);
  });

  it('shows a slot under the measured operation it is paired with', () => {
    expect(lanes.modelled[1].operationLabel).toBe('model.mlp_allreduce_and_norm_boundaries');
    expect(lanes.modelled[2].operationLabel).toBe('model.mlp_allreduce_and_norm_boundaries');
  });

  it('names a slot no measured kernel reached', () => {
    expect(lanes.modelled[3]).toMatchObject({
      claimed: false,
      operationLabel: UNCLAIMED_SLOT_LABEL,
    });
    expect(lanes.modelled[3].ms).toBeNull();
  });

  it('does not price cards from aggregate operation means', () => {
    expect(lanes.modelled.every((card) => card.ms === null)).toBe(true);
  });

  it('has no bar scale while iteration detail is unavailable', () => {
    expect(lanes.maximumMs).toBe(0);
  });

  it('uses one real iteration prediction for the modelled cards', () => {
    const predicted = boardLanes(
      sequences,
      report,
      defaultSequenceKeys(catalog),
      catalog,
      exampleBreakdown,
    );
    expect(predicted.modelled.map((card) => card.slot)).toEqual([
      'unified.mlp_block.tp_allreduce',
      'unified.attn_block.qkv_proj',
    ]);
    // The real payload can repeat one structural slot at several slot indexes;
    // the board card reports their multiplicity-weighted per-occurrence mean.
    expect(predicted.modelled[0].ms).toBeCloseTo(0.5, 9);
    expect(predicted.modelled[0].repeat).toBe(1);
    expect(predicted.modelled[1].ms).toBeCloseTo(0.5, 9);
    expect(predicted.modelled[0].timingNote).toContain('2 timing-predict leaves');
    expect(predicted.maximumMs).toBeCloseTo(0.5, 9);
  });

  it('uses rank-combined measured detail for one folded call', () => {
    const predicted = boardLanes(
      sequences,
      report,
      defaultSequenceKeys(catalog),
      catalog,
      exampleMeasuredBreakdown,
    );
    const qkv = predicted.measured.find((card) => card.name === 'nvjet');
    expect(qkv?.ms).toBeCloseTo(0.4, 9);
  });
});

describe('boardJoins', () => {
  const catalog = boardSequenceCatalog(sequences, report);
  const lanes = boardLanes(sequences, report, defaultSequenceKeys(catalog), catalog, null);

  it('declares one join per slot the label file names', () => {
    expect(boardJoins(lanes)).toEqual([
      { measuredIndex: 2, modelledIndex: 0, color: tokens.operationColorPanel[0] },
      { measuredIndex: 3, modelledIndex: 1, color: tokens.operationColorPanel[1] },
      { measuredIndex: 3, modelledIndex: 2, color: tokens.operationColorPanel[1] },
    ]);
  });
});

describe('boardCoverage', () => {
  it('reports the analyzer fractions as percentages', () => {
    expect(boardCoverage(report)).toEqual({
      measuredDurationPct: 95.88,
      simulatedWorkloadPct: 99.95,
      unmappedKernelRows: 1,
      unmappedSlots: 1,
    });
  });
});
