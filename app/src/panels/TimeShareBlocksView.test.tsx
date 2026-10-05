import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { annotate, leaf, sum } from './costTreeModel';
import { TimeShareBlocksView } from './TimeShareBlocksView';

describe('TimeShareBlocksView', () => {
  it("draws the Analyzer's composition and selects the leaf a position names", async () => {
    const tree = annotate(
      sum('root', leaf('m.gemm', 'single_gemm', {}, 4), leaf('m.norm', 'rms_norm', {}, 6)),
    );
    const onSelectKernel = vi.fn();
    render(
      <TimeShareBlocksView
        tree={tree}
        // Not the tree's 40/60 split: the view draws what it is given.
        timeShare={{
          kernelTimeMs: 8,
          segments: [
            { position: 'm.gemm', kind: 'single_gemm', kernelTimeMs: 6, sharePct: 75 },
            { position: 'm.norm', kind: 'rms_norm', kernelTimeMs: 2, sharePct: 25 },
          ],
        }}
        selectedLeafId={null}
        onSelectKernel={onSelectKernel}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'm.gemm — 6.00 ms · 75%' }));
    expect(onSelectKernel).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'm.norm — 2.00 ms · 25%' })).toBeVisible();
  });
});
