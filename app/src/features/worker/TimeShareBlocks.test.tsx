import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, max, scale, sum } from '../../domain/cost-tree';
import { useViz } from '../../store';
import TimeShareBlocks from './TimeShareBlocks';

const workerTreeMock = vi.hoisted(() => ({ state: vi.fn() }));

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerTreeState: workerTreeMock.state,
}));

const tree = annotate(
  sum(
    'root',
    leaf('attention.decode', 'flashinfer_attn_decode', {}, 95),
    leaf('attention.prefill', 'flashinfer_attn_prefill', {}, 5),
  ),
);

const largeNode = tree.kind === 'sum' ? tree.children[0] : null;
if (largeNode?.kind !== 'leaf') {
  throw new Error('Time-share interaction fixture has an invalid shape.');
}

beforeEach(() => {
  workerTreeMock.state.mockReturnValue({
    status: 'ready',
    tree,
  });
  useViz.setState({ scope: 'worker', leafId: null });
});

describe('TimeShareBlocks interaction targets', () => {
  it('selects a safely sized share by pointer and exposes pressed state', async () => {
    const user = userEvent.setup();
    render(<TimeShareBlocks />);

    const largeSegment = screen.getByRole('button', { name: /attention\.decode/ });
    expect(largeSegment).toHaveAttribute('aria-pressed', 'false');

    await user.click(largeSegment);

    expect(useViz.getState()).toMatchObject({ scope: 'kernel', leafId: largeNode.id });
    expect(largeSegment).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects a safely sized share from the keyboard', async () => {
    const user = userEvent.setup();
    render(<TimeShareBlocks />);

    const largeSegment = screen.getByRole('button', { name: /attention\.decode/ });
    largeSegment.focus();
    await user.keyboard('{Enter}');

    expect(useViz.getState()).toMatchObject({ scope: 'kernel', leafId: largeNode.id });
    expect(largeSegment).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows only the scaled critical Max branch against root wall-clock cost', () => {
    workerTreeMock.state.mockReturnValue({
      status: 'ready',
      tree: annotate(
        sum(
          'root',
          leaf('a', 'single_gemm', {}, 4),
          scale(
            'twice',
            2,
            max('parallel', 2, leaf('b', 'all_reduce', {}, 6), leaf('c', 'rms_norm', {}, 10)),
          ),
        ),
      ),
    });

    render(<TimeShareBlocks />);

    expect(screen.queryByRole('img', { name: /\bb —/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /c — 10\.00 ms · 71%/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /a — 4\.00 ms · 29%/ })).toBeVisible();
    expect(screen.getByText('100% of CostTree root wall-clock cost')).toBeVisible();
  });
});
