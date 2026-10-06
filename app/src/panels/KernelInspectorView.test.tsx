import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KernelKindsProvider } from '../test/KernelKindsProvider';
import { annotate, type LeafNode } from './costTreeModel';
import { leaf, sum } from '../test/costTreeDsl';
import { KernelInspectorView } from './KernelInspectorView';

describe('KernelInspectorView', () => {
  it("states the leaf's time share as the Analyzer attributes it", () => {
    // The whole root is this leaf's in the tree; the Analyzer says 42%.
    const tree = annotate(sum('root', leaf('m.gemm', 'single_gemm', {}, 4)));
    const node = (tree.kind === 'sum' ? tree.children[0] : tree) as LeafNode;
    render(
      <KernelInspectorView
        node={node}
        timeShare={{
          kernelTimeMs: 4 / 0.42,
          segments: [{ position: 'm.gemm', kind: 'single_gemm', kernelTimeMs: 4, sharePct: 42 }],
        }}
        height={600}
        closeLabel="Close"
        onClose={vi.fn()}
      />,
      { wrapper: KernelKindsProvider },
    );
    expect(screen.getByText('time share')).toBeVisible();
    expect(screen.getByText('42%')).toBeVisible();
  });
});
