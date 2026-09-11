import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationSummary } from '../../artifacts';
import { EMPTY_FOCUS, type Location } from '../../location';
import { WorkerWorkbenchPanel } from './WorkerWorkbenchPanel';

const fixture = vi.hoisted(() => ({
  artifact: vi.fn(),
  sequence: vi.fn(),
  shift: vi.fn(),
  move: vi.fn(),
  retry: vi.fn(),
}));
const scrolledTargets: Element[] = [];
const scrollIntoViewMock = vi.fn(function (this: Element) {
  scrolledTargets.push(this);
});
const originalMatchMedia = window.matchMedia;
const originalScrollIntoView = Element.prototype.scrollIntoView;

vi.mock('../../artifacts', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../artifacts')),
  useArtifact: fixture.artifact,
  useArtifactWithRetry: (ref: { kind: string }) => ({
    result: fixture.artifact(ref),
    retry: fixture.retry,
  }),
  useSequenceWindow: fixture.sequence,
}));

const first: OperationSummary = {
  ordinal: 64,
  ref: { iterId: '17', batchId: '2', operationId: '0' },
  section: 'pre_ffn',
  layer: 3,
  startMs: 10,
  endMs: 10.5,
};
const second: OperationSummary = {
  ordinal: 65,
  ref: { iterId: '17', batchId: '2', operationId: '1' },
  section: 'ffn',
  layer: 3,
  startMs: 12,
  endMs: 13,
};
const buffer = {
  worker: { poolTag: 'ffn', workerId: '2' },
  workerKind: 'afd_ffn' as const,
  batchRole: 'slot' as const,
  span: { startMs: 0, endMs: 20 },
  offset: 0,
  total: 256,
  operations: [first, second],
};
const viewport = { buffer, viewportOffset: 64, pending: null, nextRequestId: 0 };

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

function descriptor(
  operationStatus:
    | { status: 'ready'; schemaVersion: number; views: readonly ['payload'] }
    | { status: 'not_generated'; reason: string } = {
    status: 'ready',
    schemaVersion: 1,
    views: ['payload'],
  },
) {
  return {
    status: 'ready',
    schemaVersion: 1,
    revision: 'descriptor-etag',
    value: {
      analysis: {
        revision: 'analysis-v2',
        generatedAt: '2026-09-10T00:00:00Z',
        generatorVersion: 'test',
      },
      details: {
        'worker-operation-index': operationStatus,
        'worker-cost-tree': { status: 'ready', schemaVersion: 1, views: ['payload'] },
      },
      subjects: {
        kernelInputDistribution: {
          status: 'ready',
          schemaVersion: 1,
          views: ['payload'],
        },
      },
    },
  };
}

function controller(seek: null | { atMs: number; anchorOrdinal: number } = null) {
  return {
    result: {
      status: 'ready',
      schemaVersion: 1,
      revision: 'analysis-v2',
      value: {
        viewport,
        operations: [first, second],
        refreshing: false,
        refreshProblem: null,
        seek:
          seek === null
            ? null
            : {
                worker: buffer.worker,
                workerKind: buffer.workerKind,
                batchRole: buffer.batchRole,
                atMs: seek.atMs,
                totalOperations: buffer.total,
                span: buffer.span,
                hits: [first],
                anchor: { ordinal: seek.anchorOrdinal, kind: 'hit' },
                suggestedViewport: { offset: 64, limit: 64 },
                buffer,
              },
      },
    },
    shift: fixture.shift,
    move: fixture.move,
  };
}

const topology = {
  status: 'ready' as const,
  schemaVersion: 1,
  revision: 'analysis-v2',
  value: { pools: [], gpus: 0, deployment: 'afd' as const },
};

const treeArtifact = {
  status: 'ready' as const,
  schemaVersion: 1,
  revision: 'tree-body',
  value: {
    worker: { poolTag: 'ffn', workerId: '2' },
    operation: { iterId: '17', batchId: '2', operationId: '0' },
    section: 'pre_ffn',
    layer: 3,
    interval: { startMs: 10, endMs: 10.5 },
    inputs: [],
    tree: {
      kind: 'leaf' as const,
      slot: {
        name: 'ffn.gemm',
        kind: 'single_gemm',
        kernel_config: {},
        backend: 'torch',
      },
      base: 0.5,
      stats: { input: {}, flops: 10, bytes: 20, tflops: 0.1, gbps: 0.2 },
    },
  },
};

const kernelAnalysisArtifact = {
  status: 'ready' as const,
  schemaVersion: 1,
  revision: 'kernel-analysis-body',
  value: {
    worker: { poolTag: 'ffn', workerId: '2' },
    operation: { iterId: '17', batchId: '2', operationId: '0' },
    schemaVersion: 1 as const,
    leafId: 0,
    slot: {
      name: 'ffn.gemm',
      kind: 'single_gemm',
      kernelConfig: {},
      backend: 'torch',
    },
    exactInput: {},
    describeConfig: {},
    inputFields: ['m'],
    gridAxes: [[1, 2]],
    points: [
      { input: { m: 1 }, timeMs: 0.4, flops: 8, bytes: 16, energyJ: 0, coverage: 1 },
      { input: { m: 2 }, timeMs: 0.5, flops: 10, bytes: 20, energyJ: 0, coverage: 2 },
    ],
    semantics: 'cache_eval_at_declared_grid' as const,
  },
};

const inputDistributionArtifact = {
  status: 'ready' as const,
  schemaVersion: 1,
  revision: 'input-distribution-body',
  value: {
    positions: [
      {
        name: 'ffn.gemm',
        kind: 'single_gemm',
        candidateBackends: ['torch'],
        selection: [{ backendIndex: 0, backendName: 'torch', count: 2, ratio: 1 }],
        projection: 'feature_1d' as const,
        axisLabels: ['m', ''] as const,
        explainedVariance: null,
        points: [
          { x: 1, y: 0, backendIndex: 0, backendName: 'torch', count: 1 },
          { x: 2, y: 0, backendIndex: 0, backendName: 'torch', count: 1 },
        ],
      },
    ],
    sourceLogDir: 'logs/test-run',
    sampling: {
      stride: 1,
      sampledRows: 2,
      skippedNotExecutedSlots: 0,
      skippedEmptyInputSlots: 0,
      maxPointsPerPosition: 6000,
    },
    positionCounts: {
      plotted: 1,
      multiBackend: 0,
      manifest: 1,
      omitted: 0,
      withoutCandidates: 0,
    },
    definitions: {},
  },
};

function artifactFor(ref: { kind: string }, tree: unknown = treeArtifact) {
  if (ref.kind === 'runDescriptor') return descriptor();
  if (ref.kind === 'topology') return topology;
  if (ref.kind === 'workerCostTree') return tree;
  if (ref.kind === 'kernelThroughputAnalysis') return { status: 'pending' as const };
  if (ref.kind === 'kernelInputDistribution') {
    return {
      status: 'not_generated' as const,
      reason: 'Kernel input distribution was not generated.',
    };
  }
  return { status: 'pending' as const };
}

function location(
  path: Extract<Location, { view: 'result' }>['focus']['path'] = [
    { at: 'pool', role: 'ffn' },
    { at: 'worker', id: '2' },
  ],
  cursorMs: number | null = null,
): Extract<Location, { view: 'result' }> {
  return {
    view: 'result',
    ref: {
      kind: 'run',
      id: 'run-1',
      workspace: 'w_main',
      revision: 'descriptor-etag',
    },
    focus: { ...EMPTY_FOCUS, path: [...path], cursorMs, panel: 'worker.cost-tree' },
    chat: null,
  };
}

function pointerEvent(type: string, pointerId: number, clientX: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

beforeEach(() => {
  fixture.artifact.mockReset();
  fixture.sequence.mockReset();
  fixture.shift.mockReset();
  fixture.move.mockReset();
  fixture.retry.mockReset();
  scrollIntoViewMock.mockClear();
  scrolledTargets.length = 0;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => mediaQuery(query.includes('min-width'))),
  });
  fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref));
  fixture.sequence.mockReturnValue(controller());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D);
});

describe('WorkerWorkbenchPanel', () => {
  it('pins the dependent sequence to the descriptor analysis revision', () => {
    render(<WorkerWorkbenchPanel location={location(undefined, 10)} navigate={vi.fn()} />);

    expect(fixture.sequence).toHaveBeenCalledWith(
      expect.objectContaining({
        seq: 'operations',
        result: expect.objectContaining({ revision: 'analysis-v2' }),
        at: [
          { at: 'pool', role: 'ffn' },
          { at: 'worker', id: '2' },
        ],
      }),
      { mode: 'seek', atMs: 10 },
    );
    expect(screen.getByRole('heading', { name: 'Worker · ffn/2' })).toBeVisible();
    expect(screen.getByText('exact operation CostTree · worker operation timeline')).toBeVisible();
  });

  it('commits a clicked operation with its start time and drops deeper coordinates', () => {
    const navigate = vi.fn();
    const selectedPath = [
      { at: 'pool', role: 'ffn' },
      { at: 'worker', id: '2' },
      { at: 'operation', iter: '17', batch: '2', op: '0' },
      { at: 'leaf', id: 9 },
    ] as const;
    render(<WorkerWorkbenchPanel location={location([...selectedPath], 10)} navigate={navigate} />);
    const track = screen.getByRole('application');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 96,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 96,
      toJSON: () => ({}),
    });
    fireEvent(track, pointerEvent('pointerdown', 1, 250));
    fireEvent(track, pointerEvent('pointerup', 1, 250));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({
          cursorMs: 12,
          path: [
            { at: 'pool', role: 'ffn' },
            { at: 'worker', id: '2' },
            { at: 'operation', iter: '17', batch: '2', op: '1' },
          ],
        }),
      }),
      'push',
    );
  });

  it('does not seek again after resolving or selecting an exact operation', () => {
    const freeCursor = location(undefined, 10);
    const selectedPath = [
      ...freeCursor.focus.path,
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    const { rerender } = render(<WorkerWorkbenchPanel location={freeCursor} navigate={vi.fn()} />);

    rerender(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />);

    expect(fixture.sequence).toHaveBeenLastCalledWith(expect.anything(), { mode: 'start' });
  });

  it('resolves a free cursor to the server anchor without changing that cursor', async () => {
    fixture.sequence.mockReturnValue(controller({ atMs: 10.25, anchorOrdinal: 64 }));
    const navigate = vi.fn();
    render(<WorkerWorkbenchPanel location={location(undefined, 10.25)} navigate={navigate} />);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          focus: expect.objectContaining({
            cursorMs: 10.25,
            path: [
              { at: 'pool', role: 'ffn' },
              { at: 'worker', id: '2' },
              { at: 'operation', iter: '17', batch: '2', op: '0' },
            ],
          }),
        }),
        'replace',
      ),
    );
  });

  it('reads the selected operation CostTree at the analysis revision and commits a leaf', async () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref));
    const navigate = vi.fn();
    const user = userEvent.setup();
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    const view = render(
      <WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={navigate} />,
    );

    const costTreeRead = fixture.artifact.mock.calls
      .map(([ref]) => ref)
      .find((ref: { kind: string }) => ref.kind === 'workerCostTree');
    expect(costTreeRead).toMatchObject({
      result: { revision: 'analysis-v2' },
      worker: { poolTag: 'ffn', workerId: '2' },
      operation: { iterId: '17', batchId: '2', operationId: '0' },
    });
    expect(screen.getByRole('region', { name: 'Worker CostTree canvas' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Kernel time breakdown' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Inspect kernel ffn.gemm' }));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({ path: [...selectedPath, { at: 'leaf', id: 0 }] }),
      }),
      'push',
    );

    view.rerender(
      <WorkerWorkbenchPanel
        location={location([...selectedPath, { at: 'leaf', id: 0 }], 10)}
        navigate={navigate}
      />,
    );
    expect(screen.getByTestId('kernel-inspector')).toHaveTextContent('ffn.gemm');
    await user.click(screen.getByRole('button', { name: 'Back to worker ffn/2' }));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({ panel: null, path: selectedPath.slice(0, 2) }),
      }),
      'push',
    );
  });

  it('commits a kernel selected from the supplementary time-share row', async () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref));
    const navigate = vi.fn();
    const user = userEvent.setup();
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    render(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={navigate} />);

    const timeShare = screen.getByRole('group', { name: 'Kernel position time share' });
    await user.click(within(timeShare).getByRole('button', { name: /ffn\.gemm/ }));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({ path: [...selectedPath, { at: 'leaf', id: 0 }] }),
      }),
      'push',
    );
  });

  it('renders the old kernel evidence cards from revision-pinned exact artifacts', () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) => {
      if (ref.kind === 'kernelThroughputAnalysis') return kernelAnalysisArtifact;
      if (ref.kind === 'kernelInputDistribution') return inputDistributionArtifact;
      return artifactFor(ref);
    });
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
      { at: 'leaf' as const, id: 0 },
    ];
    render(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />);

    expect(screen.getByTestId('kernel-evidence')).toBeVisible();
    expect(screen.getByTestId('kernel-throughput-analysis-card')).toHaveTextContent(
      'Rust cache · 2 grid points',
    );
    expect(screen.getByTestId('kernel-input-distribution')).toHaveTextContent(
      'sampled every 1 iteration(s) · feature 1d',
    );
    const analysisRead = fixture.artifact.mock.calls
      .map(([ref]) => ref)
      .find((ref: { kind: string }) => ref.kind === 'kernelThroughputAnalysis');
    expect(analysisRead).toMatchObject({
      result: { revision: 'analysis-v2' },
      worker: { poolTag: 'ffn', workerId: '2' },
      operation: { iterId: '17', batchId: '2', operationId: '0' },
      leafId: 0,
    });
    const distributionRead = fixture.artifact.mock.calls
      .map(([ref]) => ref)
      .find((ref: { kind: string }) => ref.kind === 'kernelInputDistribution');
    expect(distributionRead).toMatchObject({
      result: { revision: 'analysis-v2' },
    });
  });

  it('keeps the descriptor and kernel-input payload schema handshake', () => {
    const schemaTwoDescriptor = descriptor();
    schemaTwoDescriptor.value.subjects.kernelInputDistribution.schemaVersion = 2;
    fixture.artifact.mockImplementation((ref: { kind: string }) => {
      if (ref.kind === 'runDescriptor') return schemaTwoDescriptor;
      if (ref.kind === 'kernelThroughputAnalysis') return kernelAnalysisArtifact;
      if (ref.kind === 'kernelInputDistribution') return inputDistributionArtifact;
      return artifactFor(ref);
    });
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
      { at: 'leaf' as const, id: 0 },
    ];
    render(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />);

    expect(screen.getByText('Descriptor expects schema v2, received v1.')).toBeVisible();
    expect(screen.getByText('evidence status · incompatible')).toBeVisible();
    expect(screen.queryByTestId('kernel-input-distribution')).not.toBeInTheDocument();
  });

  it('does not read kernel-input payload when the descriptor does not declare it', () => {
    const declared = descriptor();
    const withoutDistribution = {
      ...declared,
      value: { ...declared.value, subjects: {} },
    };
    fixture.artifact.mockImplementation((ref: { kind: string }) =>
      ref.kind === 'runDescriptor' ? withoutDistribution : artifactFor(ref),
    );
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
      { at: 'leaf' as const, id: 0 },
    ];
    render(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />);

    expect(
      screen.getByText('Run descriptor does not declare this analyzer subject.'),
    ).toBeVisible();
    expect(
      fixture.artifact.mock.calls.some(
        ([ref]) => (ref as { kind: string }).kind === 'kernelInputDistribution',
      ),
    ).toBe(false);
  });

  it('renders the old parallel detail below the workbench and closes to the worker', async () => {
    const parallelTree = {
      ...treeArtifact,
      value: {
        ...treeArtifact.value,
        tree: {
          kind: 'max',
          label: 'expert parallel',
          overlap: 1,
          children: [
            treeArtifact.value.tree,
            { ...treeArtifact.value.tree, slot: { ...treeArtifact.value.tree.slot, name: 'b' } },
          ],
        },
      },
    };
    fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref, parallelTree));
    const navigate = vi.fn();
    const user = userEvent.setup();
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
      { at: 'parallel' as const, id: 0 },
    ];
    render(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={navigate} />);

    expect(screen.getByText('pure Max · critical path')).toBeVisible();
    expect(screen.getByText('Load-imbalance detail not generated')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back to worker ffn/2' }));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({
          panel: null,
          path: selectedPath.slice(0, 2),
        }),
      }),
      'push',
    );
  });

  it('scrolls the workbench once when the exact selected operation tree becomes ready', () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref));
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    const view = render(
      <WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrolledTargets[0]).toBe(screen.getByTestId('worker-viewport-shell'));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    view.rerender(
      <WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('scrolls the workbench once when a kernel is selected and the shell is not fully visible', () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref));
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    const view = render(
      <WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />,
    );
    scrollIntoViewMock.mockClear();
    scrolledTargets.length = 0;

    view.rerender(
      <WorkerWorkbenchPanel
        location={location([...selectedPath, { at: 'leaf', id: 0 }], 10)}
        navigate={vi.fn()}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrolledTargets[0]).toBe(screen.getByTestId('worker-viewport-shell'));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    view.rerender(
      <WorkerWorkbenchPanel
        location={location([...selectedPath, { at: 'leaf', id: 0 }], 10)}
        navigate={vi.fn()}
      />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('does not scroll a retained tree until its exact operation identity matches', () => {
    let currentTree = {
      ...treeArtifact,
      value: {
        ...treeArtifact.value,
        operation: { iterId: '16', batchId: '1', operationId: '9' },
      },
    };
    fixture.artifact.mockImplementation((ref: { kind: string }) => artifactFor(ref, currentTree));
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    const view = render(
      <WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />,
    );
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    currentTree = treeArtifact;
    view.rerender(
      <WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('shows the exact read failure code and retries the worker detail in place', async () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) =>
      ref.kind === 'workerCostTree'
        ? { status: 'failed', code: 'HTTP_503', reason: 'Service unavailable.' }
        : artifactFor(ref),
    );
    const user = userEvent.setup();
    const selectedPath = [
      { at: 'pool' as const, role: 'ffn' },
      { at: 'worker' as const, id: '2' },
      { at: 'operation' as const, iter: '17', batch: '2', op: '0' },
    ];
    render(<WorkerWorkbenchPanel location={location(selectedPath, 10)} navigate={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('evidence status · failed · HTTP_503');
    await user.click(screen.getByRole('button', { name: 'Retry worker detail' }));
    expect(fixture.retry).toHaveBeenCalledTimes(1);
  });

  it('returns to aggregate worker analysis through the existing toggle', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<WorkerWorkbenchPanel location={location()} navigate={navigate} />);

    await user.click(screen.getByRole('button', { name: 'Worker' }));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({
          panel: null,
          path: [
            { at: 'pool', role: 'ffn' },
            { at: 'worker', id: '2' },
          ],
        }),
      }),
      'push',
    );
  });

  it('does not start a sequence when the descriptor gate is not ready', () => {
    fixture.artifact.mockImplementation((ref: { kind: string }) =>
      ref.kind === 'runDescriptor'
        ? descriptor({ status: 'not_generated', reason: 'Operation index was not generated.' })
        : ref.kind === 'topology'
          ? topology
          : { status: 'pending' },
    );
    fixture.sequence.mockReturnValue({
      result: { status: 'pending' },
      shift: fixture.shift,
      move: fixture.move,
    });
    render(<WorkerWorkbenchPanel location={location()} navigate={vi.fn()} />);

    expect(fixture.sequence).toHaveBeenCalledWith(null, null);
    expect(screen.getByText('Operation index was not generated.')).toBeVisible();
  });
});
