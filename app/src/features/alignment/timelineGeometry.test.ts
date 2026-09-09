import { describe, expect, it } from 'vitest';

import type { AlignmentCostNode, AlignmentTimelineIteration } from '../../domain/alignment';
import { GROUP } from '../../domain/cost-tree';
import { dutyBreakdown } from './dutyBreakdown';
import {
  continuousScene,
  measuredLane,
  niceTicks,
  simulatedLane,
  visibleBars,
  type LanePalette,
} from './timelineGeometry';

const NS_PER_MS = 1e6;

const iteration: AlignmentTimelineIteration = {
  iterationId: 423,
  caseIndex: 417,
  iterationType: 'mixed',
  stage: 'mixed',
  identitySequence: 'sequence_test',
  selectedAs: 'full_capture',
  anchorNs: 1000,
  gpuSpanNs: [1000, 1000 + 4 * NS_PER_MS],
  measuredGpuCycleMs: 5,
  simulatedGpuCycleMs: 4.5,
  measured: {
    criticalPathMs: 3,
    busyUnionMs: 3,
    kernels: [
      {
        nameId: 7,
        rowId: 'sequence_test:2',
        category: 'gemm_or_cutlass',
        phase: 'forward',
        operation: 'layer.qkv_projection',
        synchronizing: false,
        occurrenceNs: NS_PER_MS,
        intervals: [
          [0, 1000 + 2 * NS_PER_MS, 1000 + 3 * NS_PER_MS, 202],
          [1, 1000 + 2 * NS_PER_MS, 1000 + 3.5 * NS_PER_MS],
        ],
      },
      {
        nameId: 3,
        rowId: 'sequence_test:1',
        category: 'other',
        phase: 'preprocess',
        operation: null,
        synchronizing: false,
        occurrenceNs: NS_PER_MS,
        intervals: [[0, 1000, 1000 + 1 * NS_PER_MS]],
      },
    ],
  },
  simulated: {
    totalMs: 3.5,
    slotMs: [0.5, 1],
    slotOperation: [null, 'layer.qkv_projection'],
  },
  operationTotals: [],
  host: null,
};

const kernelNames = { 3: 'embedding_kernel', 7: 'nvjet_tst' };
const slots = [
  { name: 'unified.embedding', kind: 'elementwise' },
  { name: 'unified.attn_block.qkv_proj', kind: 'single_gemm' },
];
const familyPalette: LanePalette = {
  operationColors: {},
  operationTypes: { 'layer.qkv_projection': 'gemm' },
  unmappedColor: GROUP.misc.color,
};

describe('measuredLane', () => {
  it('keeps only the reference rank and re-bases on the span start', () => {
    const lane = measuredLane(iteration, kernelNames, 0, familyPalette);
    expect(lane).toHaveLength(2);
    expect(lane[0]).toMatchObject({ startMs: 0, endMs: 1, label: 'embedding_kernel' });
    expect(lane[1]).toMatchObject({ startMs: 2, endMs: 3, label: 'nvjet_tst' });
  });

  it('preserves correlation identity for measured kernels', () => {
    const lane = measuredLane(iteration, kernelNames, 0, familyPalette);
    expect(lane[1].correlationId).toBe(202);
  });

  it('places bars relative to a shared origin, not each iteration’s own anchor', () => {
    // Origin one millisecond before this iteration's anchor: every bar shifts by
    // exactly that, which is what puts three iterations on one axis.
    const lane = measuredLane(iteration, kernelNames, 0, familyPalette, 1000 - NS_PER_MS);
    expect(lane.map((bar) => bar.startMs)).toEqual([1, 3]);
  });
});

describe('simulatedLane', () => {
  // Sum(Leaf 0, Scale{3}(Leaf 1)) — the shape the multiplicity fallback also
  // produces, so the two placements can be compared directly.
  const sequentialNodes: AlignmentCostNode[] = [
    { kind: 'sum', children: [1, 3] },
    { kind: 'leaf', slotIndex: 0 },
    { kind: 'scale', repeats: 3, children: [3, 4] },
    { kind: 'leaf', slotIndex: 1 },
  ];

  it('repeats each slot by its Scale and lays the repeats end to end', () => {
    const lane = simulatedLane(iteration, sequentialNodes, slots, [], familyPalette);
    expect(lane.map((bar) => [bar.startMs, bar.endMs])).toEqual([
      [0, 0.5],
      [0.5, 1.5],
      [1.5, 2.5],
      [2.5, 3.5],
    ]);
  });

  it('starts the whole lane at the origin it is given', () => {
    const lane = simulatedLane(iteration, sequentialNodes, slots, [], familyPalette, 10);
    expect(lane[0].startMs).toBe(10);
    expect(lane[lane.length - 1].endMs).toBe(13.5);
  });

  it('gives every branch of a Max the same start, on its own row', () => {
    // Max{overlap: 1}(Leaf 0, Leaf 1): 0.5 ms beside 1 ms, not 1.5 ms of lane.
    const lane = simulatedLane(
      iteration,
      [
        { kind: 'max', overlap: 1, children: [1, 3] },
        { kind: 'leaf', slotIndex: 0 },
        { kind: 'leaf', slotIndex: 1 },
      ],
      slots,
      [],
      familyPalette,
    );
    expect(lane.map((bar) => [bar.startMs, bar.endMs, bar.row])).toEqual([
      [0, 0.5, 0],
      [0, 1, 1],
    ]);
  });

  it('advances a Max by its widest branch divided by the overlap', () => {
    // Sum(Max{overlap: 2}(Leaf 1), Leaf 0): the 1 ms branch contributes 0.5 ms,
    // so the slot after it starts there while the branch stays 1 ms wide.
    const lane = simulatedLane(
      iteration,
      [
        { kind: 'sum', children: [1, 3] },
        { kind: 'max', overlap: 2, children: [3, 4] },
        { kind: 'leaf', slotIndex: 0 },
        { kind: 'leaf', slotIndex: 1 },
      ],
      slots,
      [],
      familyPalette,
    );
    expect(lane.map((bar) => [bar.startMs, bar.endMs])).toEqual([
      [0, 1],
      [0.5, 1],
    ]);
  });

  it('names each repeat from the manifest slot', () => {
    const lane = simulatedLane(iteration, sequentialNodes, slots, [], familyPalette);
    expect(lane[1].label).toBe('unified.attn_block.qkv_proj');
  });

  it('does not invent a zero-duration bar for a cost-tree slot missing from the payload', () => {
    const lane = simulatedLane(
      iteration,
      [{ kind: 'leaf', slotIndex: 8 }],
      slots,
      [],
      familyPalette,
    );
    expect(lane).toEqual([]);
  });
});

describe('continuousScene', () => {
  const sceneOptions = {
    kernelNames,
    referenceDeviceId: 0,
    slotMultiplicity: [1, 1],
    slots,
    simNodes: [],
    palette: familyPalette,
  };
  const shifted = (iterationId: number, shiftNs: number): AlignmentTimelineIteration => ({
    ...iteration,
    iterationId,
    anchorNs: iteration.anchorNs + shiftNs,
    gpuSpanNs: [iteration.gpuSpanNs[0] + shiftNs, iteration.gpuSpanNs[1] + shiftNs],
    measured: {
      ...iteration.measured,
      kernels: iteration.measured.kernels.map((kernel) => ({
        ...kernel,
        intervals: kernel.intervals.map(
          ([deviceId, startNs, endNs]) => [deviceId, startNs + shiftNs, endNs + shiftNs] as const,
        ),
      })),
    },
  });
  const inputs = (
    [
      ['before', shifted(422, 0)],
      ['selected', shifted(423, 6 * NS_PER_MS)],
      ['after', shifted(424, 13 * NS_PER_MS)],
    ] as const
  ).map(([role, row]) => ({ role, iteration: row, breakdown: dutyBreakdown(row, 0) }));

  it('places every iteration by its own anchor on one axis', () => {
    const scene = continuousScene(inputs, sceneOptions)!;
    expect(scene.lanes.map((lane) => lane.offsetMs)).toEqual([0, 6, 13]);
    expect(scene.selectedIndex).toBe(1);
  });

  // The gap between one iteration's last kernel and the next one's first is the
  // number no per-iteration view can show, so it is measured, not implied.
  it('measures the wall clock between consecutive iterations', () => {
    const scene = continuousScene(inputs, sceneOptions)!;
    expect(scene.interIterationGaps.map((gap) => gap.microseconds)).toEqual([2000, 3000]);
  });

  it('carries the duty boundary as an absolute position on the shared axis', () => {
    const scene = continuousScene(inputs, sceneOptions)!;
    expect(scene.lanes[1].simulatedGpuCycleEndMs).toBe(10.5);
  });

  it('leaves the duty boundary absent on an iteration the capture never closed', () => {
    const last = { ...inputs[2], iteration: { ...inputs[2].iteration, simulatedGpuCycleMs: null } };
    const scene = continuousScene([inputs[0], inputs[1], last], sceneOptions)!;
    expect(scene.lanes[2].simulatedGpuCycleEndMs).toBeNull();
  });

  // The host block is anchor-relative while the kernels are capture-absolute:
  // subtracting the anchor from the window a second time would put the host
  // lanes a whole capture-offset to the left of the axis.
  it('opens the axis before zero when a host window does, without re-basing it', () => {
    const withHost = inputs.map((input, position) =>
      position === 1
        ? {
            ...input,
            iteration: {
              ...input.iteration,
              host: { windowNs: [-10 * NS_PER_MS, 9 * NS_PER_MS] as const, nvtx: {}, api: {} },
            },
          }
        : input,
    );
    const scene = continuousScene(withHost, sceneOptions)!;
    // Selected starts at 6ms; its host window starts at -4ms on the common axis.
    expect(scene.startMs).toBeLessThanOrEqual(-4);
    expect(scene.startMs).toBeGreaterThan(-5);
    expect(scene.lanes[1].offsetMs).toBe(6);
  });

  it('is null for a selection whose shard has not arrived', () => {
    expect(continuousScene([], sceneOptions)).toBeNull();
  });

  it('reports each drawn iteration’s own idle share, not the scene’s', () => {
    const scene = continuousScene(inputs, sceneOptions)!;
    // Span 4 ms with 2 ms of kernels on the reference rank.
    expect(scene.lanes[1].idleFraction).toBeCloseTo(0.5, 12);
    expect(scene.lanes[1].gapCount).toBe(scene.lanes[1].gaps.length);
  });
});

describe('niceTicks', () => {
  it('degenerates to the lower bound when there is no span', () => {
    expect(niceTicks(3, 3, 10)).toEqual([3]);
  });
});

describe('visibleBars', () => {
  const bars = [
    { startMs: 0, endMs: 1 },
    { startMs: 1, endMs: 1.0001 },
  ];

  it('counts sub-pixel bars instead of drawing them', () => {
    const visible = visibleBars(bars, 10, 100);
    expect(visible.drawn).toHaveLength(1);
    expect(visible.omitted).toBe(1);
  });

  it('draws everything when the plot has no width to judge by', () => {
    expect(visibleBars(bars, 10, 0).omitted).toBe(0);
  });
});
