import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, max, parallel, sum } from './costTreeModel';
import { KernelKindsProvider } from '../test/KernelKindsProvider';
import CostTreeCanvas, { COST_TREE_VIEWPORT_HEIGHT } from './CostTreeCanvas';

const controls = {
  zoomIn: 'Zoom in test tree',
  zoomOut: 'Zoom out test tree',
  fit: 'Fit test tree',
  reset: 'Reset test tree',
};
const firstTree = annotate(leaf('first.kernel', 'single_gemm', {}, 1));
const secondTree = annotate(leaf('second.kernel', 'single_gemm', {}, 2));
/** A composition as the Analyzer serves it beside a tree; the canvas only reads it. */
const composition = (position: string, kernelTimeMs: number, sharePct = 100) => ({
  kernelTimeMs: (kernelTimeMs * 100) / sharePct,
  segments: [{ position, kind: 'single_gemm', kernelTimeMs, sharePct }],
});

function rect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'button', { value: 0 });
  return event;
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
afterEach(() => vi.restoreAllMocks());

describe('CostTreeCanvas', () => {
  it('forwards selection from a nested sequential scope', async () => {
    const onSelectScope = vi.fn();
    const tree = annotate(
      sum('root', sum('projection', leaf('first.kernel', 'single_gemm', {}, 1))),
    );
    render(
      <CostTreeCanvas
        tree={tree}
        timeShare={composition('first.kernel', 1)}
        selectedLeafId={null}
        selectedParallelId={null}
        onSelectLeaf={vi.fn()}
        onSelectParallel={vi.fn()}
        onSelectScope={onSelectScope}
        onSelectRoot={vi.fn()}
        ariaLabel="Test CostTree canvas"
        controlLabels={controls}
      />,
      { wrapper: KernelKindsProvider },
    );
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Scope analysis to projection' }));
    expect(onSelectScope).toHaveBeenCalledWith(1);
  });

  it('draws rank Max and same-GPU Parallel as two kinds of card', async () => {
    const onSelectParallel = vi.fn();
    const tree = annotate(
      sum(
        'root',
        max(
          'attention',
          1,
          leaf('rank0', 'single_gemm', {}, 1),
          leaf('rank1', 'single_gemm', {}, 2),
        ),
        parallel(
          'local_experts',
          1,
          leaf('shared_expert', 'single_gemm', {}, 1),
          leaf('routed_experts', 'single_gemm', {}, 3),
        ),
      ),
    );
    const view = render(
      <CostTreeCanvas
        tree={tree}
        timeShare={composition('routed_experts', 3)}
        selectedLeafId={null}
        selectedParallelId={null}
        onSelectLeaf={vi.fn()}
        onSelectParallel={onSelectParallel}
        onSelectRoot={vi.fn()}
        ariaLabel="Test CostTree canvas"
        controlLabels={controls}
      />,
      { wrapper: KernelKindsProvider },
    );
    const rankCard = view.container.querySelector('[data-cost-node-kind="max"]');
    const streamCard = view.container.querySelector('[data-cost-node-kind="parallel"]');
    expect(rankCard).not.toBeNull();
    expect(streamCard).not.toBeNull();
    expect(within(rankCard as HTMLElement).getByText('ranks')).toBeVisible();
    expect(within(streamCard as HTMLElement).getByText('streams')).toBeVisible();
    // One lane per stream; the slower stream is the critical one.
    const lanes = (streamCard as HTMLElement).querySelectorAll('[data-stream-lane]');
    expect([...lanes].map((lane) => lane.textContent)).toEqual([
      'stream 11.00 ms',
      'stream 23.00 ms',
    ]);
    expect((streamCard as HTMLElement).querySelector('[data-critical-stream]')).toBe(lanes[1]);
    expect(rankCard?.querySelector('[data-stream-lane]')).toBeNull();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Inspect stream critical path local_experts' }));
    expect(onSelectParallel).toHaveBeenCalledWith(4);
    expect(
      screen.getByRole('button', { name: 'Inspect rank critical path attention' }),
    ).toBeVisible();
  });

  it('owns native viewport controls and resets the view for a new exact-operation tree', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('aria-label') === 'Test CostTree canvas') return rect(800, 675);
      if (this.dataset.testid === 'cost-tree-content') {
        const scale = Number(this.dataset.zoom ?? 0.9);
        return rect(200 * scale, 100 * scale);
      }
      return rect(120, 40);
    });
    const user = userEvent.setup();
    const props = {
      selectedLeafId: null,
      selectedParallelId: null,
      onSelectLeaf: vi.fn(),
      onSelectParallel: vi.fn(),
      onSelectRoot: vi.fn(),
      ariaLabel: 'Test CostTree canvas',
      controlLabels: controls,
    };
    const view = render(
      <CostTreeCanvas {...props} tree={firstTree} timeShare={composition('first.kernel', 1)} />,
      { wrapper: KernelKindsProvider },
    );
    const viewport = screen.getByRole('region', { name: 'Test CostTree canvas' });
    const content = screen.getByTestId('cost-tree-content');

    expect(viewport).toHaveStyle({ height: `${COST_TREE_VIEWPORT_HEIGHT}px` });
    expect(content.style.transform).toBe('translate(310px, 292.5px) scale(0.9)');
    await user.click(screen.getByRole('button', { name: controls.zoomIn }));
    expect(content.dataset.zoom).toBe('1.08');

    fireEvent(content, pointerEvent('pointerdown', 4, 40, 40));
    fireEvent(viewport, pointerEvent('pointermove', 4, 90, 70));
    fireEvent(viewport, pointerEvent('pointerup', 4, 90, 70));
    expect(content.style.transform).not.toBe('translate(310px, 292.5px) scale(0.9)');

    view.rerender(
      <CostTreeCanvas {...props} tree={secondTree} timeShare={composition('second.kernel', 2)} />,
    );
    expect(content.style.transform).toBe('translate(310px, 292.5px) scale(0.9)');
    expect(screen.getByRole('button', { name: 'Inspect kernel second.kernel' })).toBeVisible();
  });

  it("shows each leaf's time share as the Analyzer attributes it", async () => {
    render(
      <CostTreeCanvas
        tree={firstTree}
        // Not 100%: the share is read from the composition, never derived
        // from the tree, whose single leaf is the whole root.
        timeShare={composition('first.kernel', 1, 42)}
        selectedLeafId={null}
        selectedParallelId={null}
        onSelectLeaf={vi.fn()}
        onSelectParallel={vi.fn()}
        onSelectRoot={vi.fn()}
        ariaLabel="Test CostTree canvas"
        controlLabels={controls}
      />,
      { wrapper: KernelKindsProvider },
    );
    const node = screen.getByRole('button', { name: 'Inspect kernel first.kernel' });
    expect(within(node).getByText('42%')).toBeVisible();
    // The hover card repeats it.
    await userEvent.setup().hover(node);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('42%');
  });
});
