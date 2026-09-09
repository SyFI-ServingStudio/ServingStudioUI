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

const workerTreeMock = vi.hoisted(() => ({ state: vi.fn(), operationState: vi.fn() }));
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
const tree = annotate(leaf('ffn.gemm', 'single_gemm', {}, 3));

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
  useActiveWorkerOperationState: workerTreeMock.operationState,
}));

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRun: () => ({ id: 'run', workerList: [worker], capabilities: { perfettoTrace: false } }),
  useActiveRunState: () => ({
    status: 'ready',
    descriptor: { details: {}, analysis: { revision: 'test' } },
    run: { id: 'run', workerList: [worker], capabilities: { perfettoTrace: false } },
    error: null,
  }),
  useActiveRunSubject: () => ({ status: 'not_generated', reason: 'Not generated.' }),
}));

vi.mock('../../components/ChartCard', () => ({
  default: ({ title }: { title: string }) => <div data-testid="chart-card">{title}</div>,
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
    workerAnalysisLevel: 'iteration',
    workerKey: worker.key,
    poolRole: 'ffn',
    leafId: null,
    parId: null,
    operation: { iterId: '7', batchId: '2', operationId: '9' },
  });
  workerTreeMock.operationState.mockReturnValue({ status: 'idle', viewport: null });
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
  expect(screen.getByTestId('cost-tree-header')).toHaveStyle({
    height: `${COST_TREE_HEADER_HEIGHT}px`,
  });
}

describe('WorkerStage CostTree frame stability', () => {
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
    expect(screen.queryByText(/Worker kernel time breakdown/)).not.toBeInTheDocument();
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
});
