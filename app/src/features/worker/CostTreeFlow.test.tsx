import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, max, sum } from '../../domain/cost-tree';
import { makeWorkerKey } from '../../domain/worker';
import { useViz } from '../../store';
import CostTreeFlow from './CostTreeFlow';

const workerTreeMock = vi.hoisted(() => ({ state: vi.fn() }));

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRun: () => ({
    id: 'test-run',
    capabilities: {
      perfettoTrace: false,
    },
    workerList: [
      {
        key: 'attn/0',
        ref: { poolTag: 'attn', workerId: '0' },
        id: '0',
        arch: { type: 'test-arch' },
        gpuCount: 1,
      },
    ],
  }),
}));

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerTreeState: workerTreeMock.state,
}));

const tree = annotate(
  sum(
    'root',
    max(
      'attention branches',
      1,
      leaf('attention.prefill', 'flashinfer_attn_prefill', {}, 2),
      leaf('attention.decode', 'flashinfer_attn_decode', {}, 1),
    ),
    leaf('ffn.gemm', 'single_gemm', {}, 3),
  ),
);

const parallelNode = tree.kind === 'sum' ? tree.children[0] : null;
const kernelNode = parallelNode?.kind === 'max' ? parallelNode.children[0] : null;
if (parallelNode?.kind !== 'max' || kernelNode?.kind !== 'leaf') {
  throw new Error('CostTree interaction fixture has an invalid shape.');
}

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  workerTreeMock.state.mockReturnValue({
    status: 'ready',
    evidence: 'hierarchical-detail',
    tree,
  });
  useViz.setState({
    scope: 'worker',
    workerKey: makeWorkerKey('attn', '0'),
    poolRole: 'attn',
    leafId: null,
    parId: null,
    cursorMs: null,
    operation: { iterId: '7', batchId: '2', operationId: '9' },
  });
});

describe('CostTreeFlow interaction semantics', () => {
  it('uses named native buttons for root, parallel, and leaf drill actions', async () => {
    const user = userEvent.setup();
    render(<CostTreeFlow />);

    const root = screen.getByRole('button', { name: 'Scope to worker CostTree root' });
    const parallel = screen.getByRole('button', {
      name: 'Inspect parallel critical path attention branches',
    });
    const kernel = screen.getByRole('button', { name: 'Inspect kernel attention.prefill' });

    expect(root).toHaveAttribute('aria-pressed', 'true');
    expect(parallel).toHaveAttribute('aria-pressed', 'false');
    expect(kernel).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/overlap 1/i)).toBeInTheDocument();
    expect(screen.getAllByText(/critical path/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/iter 7 · batch 2 · operation 9/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fit worker CostTree' })).toBeVisible();

    parallel.focus();
    expect(parallel).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useViz.getState()).toMatchObject({ scope: 'parallel', parId: parallelNode.id });
    expect(parallel).toHaveAttribute('aria-pressed', 'true');

    kernel.focus();
    expect(kernel).toHaveFocus();
    await user.keyboard(' ');
    expect(useViz.getState()).toMatchObject({ scope: 'kernel', leafId: kernelNode.id });
    expect(kernel).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the shared compact canvas density in production', () => {
    const { container } = render(<CostTreeFlow />);
    const compactLeaf = container.querySelector<HTMLElement>(
      '[data-cost-node-kind="leaf"][data-cost-tree-density="compact"]',
    );
    const compactSum = container.querySelector<HTMLElement>(
      '[data-cost-node-kind="sum"][data-cost-tree-density="compact"]',
    );

    expect(compactLeaf).not.toBeNull();
    expect(compactSum).not.toBeNull();
    expect(getComputedStyle(compactLeaf!).paddingTop).toBe('6.5px');
    expect(getComputedStyle(compactLeaf!).gap).toBe('1px');
    expect(getComputedStyle(compactSum!).paddingTop).toBe('6.8px');
    expect(getComputedStyle(compactSum!).gap).toBe('3.2px');
    expect(getComputedStyle(compactSum!).borderStyle).toBe('solid');
    expect(getComputedStyle(compactSum!).borderColor).toBe('rgba(74, 91, 104, 0.34)');
    expect(getComputedStyle(compactSum!).backgroundColor).toBe('rgba(74, 91, 104, 0.035)');
  });
});
