import { describe, expect, it } from 'vitest';

import type {
  AlignmentHostEvent,
  AlignmentHostTimelineMeta,
  AlignmentTimelineIteration,
} from '../../artifacts/schema/alignmentTypes';
import { groupedHostLanes, HOST_NVTX_DEPTHS } from './hostLanes';

const NS_PER_MS = 1e6;

const meta: AlignmentHostTimelineMeta = {
  source: 'host_timeline.json',
  windowRule: 'an iteration window is the reference-rank GPU span unioned with the NVTX phases.',
  ownershipRule: 'a host event belongs to every iteration whose window it overlaps.',
  apiClasses: ['kernel launch', 'memcpy', 'synchronize'],
  threads: [
    {
      globalTid: 1,
      deviceId: null,
      process: 'VLLM::EngineCor',
      role: 'scheduler thread',
      main: true,
    },
    {
      globalTid: 2,
      deviceId: 0,
      process: 'VLLM::Worker_TP',
      role: 'worker main thread',
      main: true,
    },
    {
      globalTid: 3,
      deviceId: 0,
      process: 'VLLM::Worker_TP',
      role: 'worker helper thread',
      main: false,
    },
    {
      globalTid: 4,
      deviceId: 1,
      process: 'VLLM::Worker_TP',
      role: 'worker main thread',
      main: true,
    },
  ],
  strings: ['forward', 'preprocess', 'cudaLaunchKernel', 'cudaMemcpyAsync'],
  unclosedNvtxMarks: 0,
};

function iteration(
  iterationId: number,
  host: AlignmentTimelineIteration['host'],
): AlignmentTimelineIteration {
  return {
    iterationId,
    caseIndex: 0,
    iterationType: 'decode',
    stage: 'decode',
    identitySequence: 'sequence_test',
    selectedAs: 'full_capture',
    anchorNs: 0,
    gpuSpanNs: [0, NS_PER_MS],
    measuredGpuCycleMs: 1,
    simulatedGpuCycleMs: 1,
    measured: { criticalPathMs: 1, busyUnionMs: 1, kernels: [] },
    simulated: { totalMs: 1, slotMs: [], slotOperation: [] },
    operationTotals: [],
    host,
  };
}

// Lanes are keyed by index into `meta.threads`: 0 is the scheduler, 1 the
// rank-0 main thread, 2 a rank-0 helper, 3 a rank-1 thread this window drops.
const populated = iteration(8, {
  windowNs: [-NS_PER_MS, 2 * NS_PER_MS],
  nvtx: {
    0: [[0, NS_PER_MS, 1, 0]],
    1: [
      [0, NS_PER_MS, 0, 0],
      [0.2 * NS_PER_MS, 0.3 * NS_PER_MS, 1, 1],
      [0.25 * NS_PER_MS, 0.1 * NS_PER_MS, 1, HOST_NVTX_DEPTHS],
    ],
    3: [[0, NS_PER_MS, 0, 0]],
  },
  api: {
    1: [
      [0.1 * NS_PER_MS, 0.2 * NS_PER_MS, 2, 0, 101],
      [0.4 * NS_PER_MS, 0.1 * NS_PER_MS, 3, 1],
    ],
    2: [[0.5 * NS_PER_MS, 0.1 * NS_PER_MS, 2, 0]],
    3: [[0.1 * NS_PER_MS, 0.2 * NS_PER_MS, 2, 0]],
  },
});

const axis = { startMs: -2, endMs: 4 };

function shiftHostEvent(event: AlignmentHostEvent, shiftNs: number): AlignmentHostEvent {
  const [startNs, durationNs, stringId, classifier, correlationId] = event;
  return correlationId === undefined
    ? [startNs - shiftNs, durationNs, stringId, classifier]
    : [startNs - shiftNs, durationNs, stringId, classifier, correlationId];
}

describe('groupedHostLanes', () => {
  it('is null when the capture carries no host sidecar', () => {
    expect(groupedHostLanes([{ iteration: populated, offsetMs: 0 }], null, 0, axis)).toBeNull();
  });

  it('folds a dozen threads into the four rows the card draws', () => {
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 0 }], meta, 0, axis)!;
    expect(census.lanes.map((lane) => [lane.key, lane.label, lane.rows.length])).toEqual([
      ['scheduler', 'scheduler', 1],
      ['workerNvtx', 'host/0', 2],
      ['workerApi', '└ cuda api', 2],
      ['helperApi', '└ helpers', 1],
    ]);
    expect(census.lanes[2].rows[0].correlationId).toBe(101);
  });

  it('draws no lane for a rank that is not the reference', () => {
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 0 }], meta, 0, axis)!;
    const labels = census.lanes.flatMap((lane) => lane.rows.map((row) => row.label));
    // The rank-1 thread's `forward` and its launch are both absent.
    expect(labels.filter((label) => label === 'forward')).toHaveLength(1);
    expect(census.hiddenThreadCount).toBe(1);
    expect(census.hiddenThreadRoles).toEqual(['worker main thread']);
  });

  it('counts marks nested past the drawn depth instead of drawing them', () => {
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 0 }], meta, 0, axis)!;
    expect(census.deeperMarks).toBe(1);
    expect(census.nvtxMarks).toBe(3);
  });

  it('offsets host rows by the axis position and never by the anchor', () => {
    // The payload's rows are already anchor-relative; a second subtraction is
    // the bug this file exists to prevent.
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 5 }], meta, 0, {
      startMs: -2,
      endMs: 10,
    })!;
    expect(census.lanes[1].rows[0]).toMatchObject({ startMs: 5, endMs: 6 });
  });

  // Consecutive windows overlap by the analyzer's own ownership rule, so the
  // same call arrives from two iterations and would otherwise draw twice.
  it('deduplicates a row two overlapping windows both own', () => {
    // The neighbour is anchored half a millisecond later and reports the same
    // calls half a millisecond earlier, so both reach the same instant on the
    // axis by different sums — which is the whole point: the key is absolute
    // capture nanoseconds, not the floating-point millisecond either arrived at.
    const shift = 0.5 * NS_PER_MS;
    const neighbour: AlignmentTimelineIteration = {
      ...iteration(9, null),
      anchorNs: shift,
      host: {
        windowNs: [populated.host!.windowNs[0] - shift, populated.host!.windowNs[1] - shift],
        nvtx: Object.fromEntries(
          Object.entries(populated.host!.nvtx).map(([thread, rows]) => [
            thread,
            rows.map((event) => shiftHostEvent(event, shift)),
          ]),
        ),
        api: Object.fromEntries(
          Object.entries(populated.host!.api).map(([thread, rows]) => [
            thread,
            rows.map((event) => shiftHostEvent(event, shift)),
          ]),
        ),
      },
    };
    const census = groupedHostLanes(
      [
        { iteration: populated, offsetMs: 0 },
        { iteration: neighbour, offsetMs: 0.5 },
      ],
      meta,
      0,
      axis,
    )!;
    expect(census.lanes[2].rows).toHaveLength(2);
    expect(census.nvtxMarks).toBe(3);
  });

  it('counts rows wholly outside the axis rather than drawing them', () => {
    const narrow = { startMs: 0.35, endMs: 4 };
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 0 }], meta, 0, narrow)!;
    expect(census.offAxisRows).toBe(1);
    expect(census.lanes[2].rows.map((row) => row.label)).toEqual(['cudaMemcpyAsync']);
  });

  it('totals each API class by the analyzer`s own class index', () => {
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 0 }], meta, 0, axis)!;
    expect(census.apiTotals.map((entry) => [entry.class, entry.classIndex, entry.calls])).toEqual([
      ['kernel launch', 0, 2],
      ['memcpy', 1, 1],
    ]);
    expect(census.apiTotals[0].ms).toBeCloseTo(0.3, 12);
  });

  it('carries the analyzer rules and source through verbatim', () => {
    const census = groupedHostLanes([{ iteration: populated, offsetMs: 0 }], meta, 0, axis)!;
    expect(census.windowRule).toBe(meta.windowRule);
    expect(census.ownershipRule).toBe(meta.ownershipRule);
    expect(census.source).toBe(meta.source);
  });
});
