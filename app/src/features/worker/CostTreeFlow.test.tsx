import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, max, scale, sum } from '../../domain/cost-tree';
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
    scale(
      'two attention blocks',
      2,
      max(
        'attention branches',
        1,
        leaf('attention.prefill', 'flashinfer_attn_prefill', {}, 2, 'fa3', {
          input: null,
          flops: 2_469_000_000_000,
          bytes: 5_606_500_000,
          tflops: 1_234.5,
          gbps: 2_803.25,
        }),
        leaf('attention.prefill', 'flashinfer_attn_prefill', {}, 2, 'fa3'),
      ),
    ),
    leaf('ffn.gemm', 'single_gemm', {}, 3),
  ),
);

const scaledParallelNode = tree.kind === 'sum' ? tree.children[0] : null;
const parallelNode = scaledParallelNode?.kind === 'scale' ? scaledParallelNode.children[0] : null;
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
  it('shows only the compact kernel facts with shared engineering units on hover', async () => {
    const user = userEvent.setup();
    render(<CostTreeFlow />);

    const [kernelCard] = screen.getAllByRole('button', {
      name: 'Inspect kernel attention.prefill',
    });
    if (kernelCard === undefined) throw new Error('Expected an attention.prefill kernel card.');
    expect(within(kernelCard).getByText('57%')).toBeVisible();
    await user.hover(kernelCard);
    const tooltip = await screen.findByRole('tooltip');
    const facts = within(tooltip);

    expect(facts.getByText('Kind')).toBeVisible();
    expect(facts.getByText('flashinfer_attn_prefill')).toBeVisible();
    expect(facts.getByText('Backend')).toBeVisible();
    expect(facts.getByText('fa3')).toBeVisible();
    expect(facts.getByText('Time')).toBeVisible();
    expect(facts.getByText('2.00 ms')).toBeVisible();
    expect(facts.getByText('Time share')).toBeVisible();
    expect(facts.getByText('57%')).toBeVisible();
    expect(facts.getByText('Compute')).toBeVisible();
    expect(facts.getByText('1.23 PFLOP/s')).toBeVisible();
    expect(facts.getByText('Bandwidth')).toBeVisible();
    expect(facts.getByText('2.8 TB/s')).toBeVisible();
    expect(facts.queryByText(/config/i)).not.toBeInTheDocument();
  });

  it('expands within the browser viewport and restores page scrolling on exit', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<CostTreeFlow />);

    const expand = screen.getByRole('button', {
      name: 'Expand worker CostTree to fill browser',
    });
    await user.click(expand);

    expect(screen.getByTestId('cost-tree-frame')).toHaveStyle({
      position: 'fixed',
      inset: '0',
      height: '100dvh',
    });
    expect(document.body.style.overflow).toBe('hidden');
    const restore = screen.getByRole('button', { name: 'Restore worker CostTree layout' });
    expect(restore).toHaveAttribute('aria-pressed', 'true');

    await user.click(restore);
    expect(screen.getByTestId('cost-tree-frame')).toHaveStyle({ position: 'relative' });
    expect(document.body.style.overflow).toBe('auto');

    await user.click(
      screen.getByRole('button', { name: 'Expand worker CostTree to fill browser' }),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('cost-tree-frame')).toHaveStyle({ position: 'relative' });
    expect(document.body.style.overflow).toBe('auto');
  });

  it('uses named native buttons for root, parallel, and leaf drill actions', async () => {
    const user = userEvent.setup();
    render(<CostTreeFlow />);

    const root = screen.getByRole('button', { name: 'Scope to worker CostTree root' });
    const parallel = screen.getByRole('button', {
      name: 'Inspect parallel critical path attention branches',
    });
    const [kernel] = screen.getAllByRole('button', { name: 'Inspect kernel attention.prefill' });
    if (kernel === undefined) throw new Error('Expected an attention.prefill kernel card.');

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
