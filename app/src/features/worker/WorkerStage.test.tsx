import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf } from '../../domain/cost-tree';
import { makeWorkerKey } from '../../domain/worker';
import { useViz } from '../../store';
import { COST_TREE_HEADER_HEIGHT, WORKER_WORKBENCH_HEIGHT } from './CostTreeFrame';
import WorkerStage, {
  WORKER_VIEWPORT_HEIGHT_VAR,
  WORKER_VIEWPORT_SAFE_GAP,
  WORKER_WORKBENCH_MIN_HEIGHT,
  WORKER_WORKBENCH_MIN_HEIGHT_VAR,
} from './WorkerStage';

const workerTreeMock = vi.hoisted(() => ({ state: vi.fn() }));
const scrolledTargets: Element[] = [];
const scrollIntoViewMock = vi.fn(function (this: Element) {
  scrolledTargets.push(this);
});
const originalMatchMedia = window.matchMedia;

const worker = {
  key: makeWorkerKey('ffn', '1'),
  ref: { poolTag: 'ffn', workerId: '1' },
  id: '1',
  arch: { type: 'qwen3_ffn_moe' },
  gpuCount: 8,
};
const tree = annotate(leaf('ffn.gemm', 'single_gemm', '{}', 3));

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

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerTreeState: workerTreeMock.state,
}));

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRun: () => ({ id: 'run', workerList: [worker], capabilities: { perfettoTrace: false } }),
  useActiveRunState: () => ({ status: 'ready', descriptor: { details: {} } }),
  useActiveRunSubject: () => ({ status: 'not_generated', reason: 'Not generated.' }),
}));

vi.mock('../timeline', () => ({
  WorkerOperationTimeline: () => <div data-testid="operation-timeline" />,
}));

vi.mock('../kernel', () => ({
  KernelInspector: ({ height }: { height: number | string }) =>
    useViz.getState().scope === 'kernel' ? (
      <div data-testid="kernel-inspector" style={{ height }} />
    ) : null,
  KernelEvidence: () =>
    useViz.getState().scope === 'kernel' ? <div data-testid="kernel-evidence" /> : null,
  ParallelDetail: () => <div data-testid="parallel-detail" />,
}));

vi.mock('../metrics', () => ({
  KernelTimeBreakdownCard: ({ title }: { title: string }) => (
    <div data-testid="worker-kernel-time-breakdown">{title}</div>
  ),
}));

vi.mock('./TimeShareBlocks', () => ({
  default: () => <div data-testid="time-share" />,
}));

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
});

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  scrolledTargets.length = 0;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => mediaQuery(query.includes('min-width'))),
  });
  useViz.setState({
    scope: 'worker',
    workerKey: worker.key,
    poolRole: 'ffn',
    leafId: null,
    parId: null,
    operation: { iterId: '7', batchId: '2', operationId: '9' },
  });
});

function expectStableCostTreeFrame(): void {
  const shell = screen.getByTestId('worker-viewport-shell');
  expect(shell).toHaveStyle({ display: 'grid' });
  expect(getComputedStyle(shell).getPropertyValue(WORKER_VIEWPORT_HEIGHT_VAR)).toBe(
    `calc(100dvh - ${WORKER_VIEWPORT_SAFE_GAP}px)`,
  );
  expect(getComputedStyle(shell).getPropertyValue(WORKER_WORKBENCH_MIN_HEIGHT_VAR)).toBe(
    `${WORKER_WORKBENCH_MIN_HEIGHT}px`,
  );
  expect(screen.getByTestId('worker-workbench-row')).toHaveStyle({ minHeight: '0' });
  expect(screen.getByTestId('cost-tree-frame')).toBeVisible();
  expect(screen.getByTestId('cost-tree-frame')).toHaveStyle({
    height: WORKER_WORKBENCH_HEIGHT,
  });
  expect(screen.getByTestId('cost-tree-viewport')).toHaveStyle({ flex: '1', minHeight: '0' });
  expect(screen.getByTestId('cost-tree-frame').firstElementChild).toHaveStyle({
    height: `${COST_TREE_HEADER_HEIGHT}px`,
  });
}

describe('WorkerStage CostTree frame stability', () => {
  it.each([
    {
      label: 'idle',
      state: { status: 'idle', worker: null, tree: null, error: null, retry: null },
    },
    {
      label: 'awaiting selection',
      state: { status: 'awaiting-selection', worker, tree: null, error: null, retry: null },
    },
    {
      label: 'loading',
      state: { status: 'loading', worker, tree: null, error: null, retry: null },
    },
    {
      label: 'error',
      state: {
        status: 'error',
        worker,
        tree: null,
        error: new Error('bad worker'),
        retry: null,
      },
    },
    {
      label: 'non-ready detail',
      state: {
        status: 'unavailable',
        worker,
        tree: null,
        reason: 'No CostTree detail.',
        code: null,
        retry: null,
      },
    },
  ])('keeps the shared dimensions for $label', ({ state }) => {
    workerTreeMock.state.mockReturnValue(state);
    render(<WorkerStage />);

    expectStableCostTreeFrame();
    expect(screen.getByTestId('operation-timeline')).toBeVisible();
    expect(screen.queryByTestId('kernel-inspector')).not.toBeInTheDocument();
  });

  it('replaces pending copy with the ready tree without collapsing the frame', () => {
    workerTreeMock.state.mockReturnValue({
      status: 'awaiting-selection',
      worker,
      tree: null,
      error: null,
      retry: null,
    });
    const view = render(<WorkerStage />);
    expectStableCostTreeFrame();

    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });
    view.rerender(<WorkerStage />);

    expectStableCostTreeFrame();
    expect(screen.getByRole('region', { name: 'Worker CostTree canvas' })).toBeVisible();
    expect(screen.getByTestId('worker-exact-workbench')).toBeVisible();
    expect(screen.getByTestId('kernel-inspector-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('kernel-inspector-placeholder')).toHaveStyle({
      height: WORKER_WORKBENCH_HEIGHT,
    });
    expect(screen.queryByTestId('kernel-inspector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kernel-evidence')).not.toBeInTheDocument();
    expect(screen.getByTestId('parallel-detail')).toBeVisible();
    expect(screen.getByTestId('time-share')).toBeVisible();
    expect(screen.getByTestId('worker-kernel-time-breakdown')).toHaveTextContent(
      'Worker kernel time breakdown · ffn/1',
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrolledTargets[0]).toBe(screen.getByTestId('worker-viewport-shell'));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    view.rerender(<WorkerStage />);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the workbench columns stable and scrolls it once when a kernel is selected', () => {
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });
    const view = render(<WorkerStage />);
    scrollIntoViewMock.mockClear();
    scrolledTargets.length = 0;

    useViz.setState({ scope: 'kernel', leafId: tree.id });
    view.rerender(<WorkerStage />);

    expect(screen.queryByTestId('kernel-inspector-placeholder')).not.toBeInTheDocument();
    expect(screen.getByTestId('kernel-inspector')).toBeVisible();
    expect(screen.getByTestId('kernel-inspector')).toHaveStyle({
      height: WORKER_WORKBENCH_HEIGHT,
    });
    expect(screen.getByTestId('kernel-evidence')).toBeVisible();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrolledTargets[0]).toBe(screen.getByTestId('worker-viewport-shell'));
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    view.rerender(<WorkerStage />);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('does not move the page again when a kernel is selected inside a fully visible shell', () => {
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });
    const view = render(<WorkerStage />);
    scrollIntoViewMock.mockClear();
    vi.spyOn(screen.getByTestId('worker-viewport-shell'), 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 6,
      top: 6,
      left: 0,
      right: 1192,
      bottom: 714,
      width: 1192,
      height: 708,
      toJSON: () => ({}),
    });

    useViz.setState({ scope: 'kernel', leafId: tree.id });
    view.rerender(<WorkerStage />);

    expect(screen.getByTestId('kernel-inspector')).toBeVisible();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('hides the empty inspector placeholder in the narrow single-column fallback', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mediaQuery(false)),
    });
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });
    render(<WorkerStage />);

    expect(screen.getByTestId('worker-exact-workbench')).toHaveStyle({ minWidth: '0' });
    expect(screen.queryByTestId('kernel-inspector-placeholder')).not.toBeInTheDocument();
  });

  it('uses the minimum workbench row and start alignment when the shell is taller than a short viewport', () => {
    const originalInnerHeight = window.innerHeight;
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'worker-viewport-shell' ? 640 : 0;
      });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 420 });
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });

    try {
      render(<WorkerStage />);
      expect(
        getComputedStyle(screen.getByTestId('worker-viewport-shell')).getPropertyValue(
          WORKER_WORKBENCH_MIN_HEIGHT_VAR,
        ),
      ).toBe(`${WORKER_WORKBENCH_MIN_HEIGHT}px`);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    } finally {
      scrollHeight.mockRestore();
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });

  it('does not scroll a retained tree until its exact operation identity matches', () => {
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '6', batchId: '1', operationId: '8' },
      tree,
      error: null,
      retry: null,
    });
    const view = render(<WorkerStage />);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });
    view.rerender(<WorkerStage />);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('uses instant page scrolling when reduced motion is requested', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mediaQuery(true)),
    });
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
      error: null,
      retry: null,
    });
    render(<WorkerStage />);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    });
  });
});
