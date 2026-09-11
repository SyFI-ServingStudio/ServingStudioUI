import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ArtifactModule from '../artifacts';

vi.mock('../artifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof ArtifactModule>();
  return { ...actual, readArtifact: vi.fn(), fetchSequence: vi.fn() };
});

import { fetchSequence, readArtifact, type ArtifactRef } from '../artifacts';
import { EMPTY_FOCUS, type Location, type Segment } from '../location';
import { resolveLocation } from './resolve';

const read = vi.mocked(readArtifact);
const sequence = vi.mocked(fetchSequence);
const WORKER: Segment[] = [
  { at: 'pool', role: 'a b' },
  { at: 'worker', id: 'x/y' },
];

function location(path: Segment[], cursorMs: number | null = null): Location {
  return {
    view: 'result',
    ref: { kind: 'run', id: 'r_one', workspace: 'w_main' },
    focus: { ...EMPTY_FOCUS, path, cursorMs, panel: 'worker.cost-tree' },
    chat: null,
  };
}

function descriptor(distributionSchemaVersion = 1) {
  return {
    analysis: { revision: 'analysis two' },
    details: {
      'worker-operation-index': { status: 'ready', schemaVersion: 1, views: ['payload'] },
      'worker-cost-tree': { status: 'ready', schemaVersion: 1, views: ['payload'] },
    },
    subjects: {
      kernelInputDistribution: {
        status: 'ready',
        schemaVersion: distributionSchemaVersion,
        views: ['payload'],
      },
    },
  };
}

function installReadyReads(distributionPayloadVersion = 1): void {
  read.mockImplementation(async (ref: ArtifactRef) => {
    if (ref.kind === 'catalog') {
      return {
        status: 'ready',
        value: [
          {
            kind: 'run',
            id: 'r_one',
            workspace: 'w_main',
            displayName: 'Run one',
            status: 'ready',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
        schemaVersion: 1,
        revision: 'catalog-one',
      } as never;
    }
    if (ref.kind === 'runDescriptor') {
      return {
        status: 'ready',
        value: descriptor(),
        schemaVersion: 1,
        revision: 'descriptor-one',
      } as never;
    }
    return {
      status: 'ready',
      value: {},
      schemaVersion: ref.kind === 'kernelInputDistribution' ? distributionPayloadVersion : 1,
      revision: 'artifact-one',
    } as never;
  });
  sequence.mockResolvedValue({
    status: 'ready',
    value: {},
    schemaVersion: 1,
    revision: 'analysis two',
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  installReadyReads();
});

describe('resolveLocation worker workbench availability', () => {
  it('pins the worker sequence to the descriptor revision and seeks a cursor', async () => {
    await expect(resolveLocation(location(WORKER, 12.5))).resolves.toBe('ok');

    expect(sequence).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ revision: 'analysis two' }) }),
      { mode: 'seek', atMs: 12.5 },
      undefined,
    );
  });

  it('reads the exact revision-pinned CostTree for an operation', async () => {
    const path = [...WORKER, { at: 'operation', iter: '2', batch: '3', op: '4' } as const];
    await expect(resolveLocation(location(path))).resolves.toBe('ok');

    expect(sequence).toHaveBeenCalledWith(
      expect.anything(),
      { mode: 'range', offset: 0, limit: 1 },
      undefined,
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workerCostTree',
        result: expect.objectContaining({ revision: 'analysis two' }),
      }),
      undefined,
    );
  });

  it('requires matching KTA and KID schemas for a selected leaf', async () => {
    installReadyReads(2);
    const path = [
      ...WORKER,
      { at: 'operation', iter: '2', batch: '3', op: '4' } as const,
      { at: 'leaf', id: 5 } as const,
    ];
    await expect(resolveLocation(location(path))).resolves.toBe('unavailable');

    const exactReads = read.mock.calls.map(([ref]) => ref).filter((ref) => 'result' in ref);
    expect(exactReads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'kernelThroughputAnalysis',
          result: expect.objectContaining({ revision: 'analysis two' }),
        }),
        expect.objectContaining({
          kind: 'kernelInputDistribution',
          result: expect.objectContaining({ revision: 'analysis two' }),
        }),
      ]),
    );
  });
});

function sweepLocation(options: Record<string, string>, path: Segment[] = []): Location {
  return {
    view: 'result',
    ref: { kind: 'sweep', id: 's_one', workspace: 'w_main' },
    focus: { ...EMPTY_FOCUS, panel: 'sweep.page', options, path },
    chat: null,
  };
}

function installSweepReads(): void {
  read.mockImplementation(async (ref: ArtifactRef) => {
    if (ref.kind === 'catalog') {
      return {
        status: 'ready',
        value: [
          {
            kind: 'sweep',
            id: 's_one',
            workspace: 'w_main',
            displayName: 'Sweep one',
            status: 'ready',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
        schemaVersion: 1,
      } as never;
    }
    if (ref.kind === 'sweepAnalysis') {
      return {
        status: 'ready',
        value: {
          protocolVersion: 1,
          schemaVersion: 1,
          workspaceId: 'w_main',
          sweepId: 's_one',
          displayName: 'Sweep one',
          axes: ['tp'],
          domains: { tp: [1, 2] },
          metrics: [
            {
              group: 'latency',
              key: 'latency_mean',
              label: 'Mean latency',
              unit: 'ms',
              objective: 'minimize',
            },
            {
              group: 'latency',
              key: 'latency_p99',
              label: 'P99 latency',
              unit: 'ms',
              objective: 'minimize',
            },
          ],
          runs: [
            {
              runId: 'r_one',
              coordinates: { tp: 1 },
              labels: { tp: 'TP 1' },
              lifecycle: { simulation: 'complete', analysis: 'complete' },
              metrics: { latency_mean: 1, latency_p99: 2 },
            },
          ],
          definitions: {},
        },
        schemaVersion: 1,
      } as never;
    }
    return { status: 'transport-error', reason: 'unexpected read' } as never;
  });
}

describe('resolveLocation sweep semantics', () => {
  it('resolves a dynamic panel, statistic, and coordinate-only member', async () => {
    installSweepReads();
    await expect(
      resolveLocation(
        sweepLocation({ 'evidence-panel': 'latency', metric: 'latency_p99', stat: 'p99' }, [
          { at: 'run', coordinates: { tp: 1 } },
        ]),
      ),
    ).resolves.toBe('ok');
  });

  it.each([
    ['metric', sweepLocation({ 'evidence-panel': 'latency', metric: 'missing', stat: 'p99' })],
    [
      'statistic',
      sweepLocation({ 'evidence-panel': 'latency', metric: 'latency_mean', stat: 'other' }),
    ],
    [
      'member',
      sweepLocation({ 'evidence-panel': 'latency', metric: 'latency_mean', stat: 'mean' }, [
        { at: 'run', coordinates: { tp: 9 } },
      ]),
    ],
    [
      'contradictory member identity',
      sweepLocation({ 'evidence-panel': 'latency', metric: 'latency_mean', stat: 'mean' }, [
        { at: 'run', id: 'r_one', coordinates: { tp: 9 } },
      ]),
    ],
  ])('reports an invalid %s as not-found', async (_label, target) => {
    installSweepReads();
    await expect(resolveLocation(target)).resolves.toBe('not-found');
  });
});

function alignmentLocation(iterationId?: number): Location {
  return {
    view: 'result',
    ref: { kind: 'alignment', id: 'al_one', workspace: 'w_main' },
    focus: {
      ...EMPTY_FOCUS,
      panel: 'alignment.page',
      path: iterationId === undefined ? [] : [{ at: 'iteration', id: iterationId }],
    },
    chat: null,
  };
}

function installAlignmentReads({
  timeline = false,
  iterationDetail = false,
}: { timeline?: boolean; iterationDetail?: boolean } = {}): void {
  read.mockImplementation(async (ref: ArtifactRef) => {
    if (ref.kind === 'catalog') {
      return {
        status: 'ready',
        value: [
          {
            kind: 'alignment',
            id: 'al_one',
            workspace: 'w_main',
            displayName: 'Alignment one',
            status: 'partial',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
        schemaVersion: 1,
      } as never;
    }
    if (ref.kind === 'alignmentDescriptor') {
      return {
        status: 'ready',
        value: {
          alignmentId: 'al_one',
          displayName: 'Alignment one',
          lifecycle: { kernelAnalysis: 'complete', e2eAnalysis: 'not_started' },
          prediction: null,
          subjects: {
            iteration: { status: 'ready', hasIterationDetail: iterationDetail },
            timeline: {
              status: timeline ? 'ready' : 'not_generated',
              hasIterationDetail: timeline,
            },
            workload: { status: 'not_generated', hasIterationDetail: false },
            e2e: { status: 'not_generated', hasIterationDetail: false },
          },
        },
        schemaVersion: 1,
      } as never;
    }
    if (ref.kind === 'alignmentIterationReport') {
      return { status: 'ready', value: { iterations: [{ iterationId: 6 }] } } as never;
    }
    if (ref.kind === 'alignmentIterationSeries') {
      return { status: 'ready', value: { iterations: [{ iterationId: 6 }] } } as never;
    }
    if (ref.kind === 'alignmentTimelineIndex') {
      return { status: 'ready', value: { iterations: [{ iterationId: 1025 }] } } as never;
    }
    if (ref.kind === 'alignmentTimelineIteration') {
      return { status: 'ready', value: { iterationId: ref.iterationId } } as never;
    }
    if (ref.kind === 'alignmentBreakdown') {
      return { status: 'ready', value: { iterationId: ref.iterationId } } as never;
    }
    return { status: 'failed', code: 'unexpected', reason: `unexpected ${ref.kind}` } as never;
  });
}

describe('resolveLocation alignment semantics', () => {
  it('reads only subjects declared ready by a partial descriptor', async () => {
    installAlignmentReads();
    await expect(resolveLocation(alignmentLocation(6))).resolves.toBe('ok');
    expect(read.mock.calls.map(([ref]) => ref.kind)).toEqual([
      'catalog',
      'alignmentDescriptor',
      'alignmentIterationReport',
      'alignmentIterationSeries',
    ]);
  });

  it('accepts a timeline-only selected iteration and resolves its exact detail', async () => {
    installAlignmentReads({ timeline: true, iterationDetail: true });
    await expect(resolveLocation(alignmentLocation(1025))).resolves.toBe('ok');
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'alignmentTimelineIteration', iterationId: 1025 }),
      undefined,
    );
    expect(read).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'alignmentBreakdown' }),
      undefined,
    );
  });

  it('reports a selected iteration absent from every ready index', async () => {
    installAlignmentReads({ iterationDetail: true });
    await expect(resolveLocation(alignmentLocation(999))).resolves.toBe('not-found');
    expect(read).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'alignmentBreakdown' }),
      undefined,
    );
  });
});
