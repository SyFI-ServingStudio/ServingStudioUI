import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, sum } from '../../domain/cost-tree';
import { useViz } from '../../store';
import TimeShareBlocks from './TimeShareBlocks';

const workerTreeMock = vi.hoisted(() => ({ state: vi.fn() }));

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerTreeState: workerTreeMock.state,
}));

const tree = annotate(
  sum(
    'root',
    leaf('attention.decode', 'flashinfer_attn_decode', '{}', 95),
    leaf('attention.prefill', 'flashinfer_attn_prefill', '{}', 5),
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
  it('keeps a tiny share exact and non-target', () => {
    render(<TimeShareBlocks />);

    const bar = screen.getByRole('group', { name: 'Kernel position time share' });
    const tinySegment = screen.getByRole('img', {
      name: /attention\.prefill/,
    });

    expect(bar).toContainElement(tinySegment);
    expect(
      screen.queryByRole('button', {
        name: /attention\.prefill/,
      }),
    ).not.toBeInTheDocument();
    expect(tinySegment).toHaveStyle({
      width: '5%',
      boxSizing: 'border-box',
      flex: '0 0 auto',
      minWidth: '0',
      paddingLeft: '0',
      paddingRight: '0',
    });
  });

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
});
