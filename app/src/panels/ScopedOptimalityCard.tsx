import { useMemo } from 'react';

import { scopedOptimalityRef } from '../artifacts';
import type { ResultRef } from '../location';
import { nodeById, nodeOrdinalPath, type CostNode, type CostTree } from './costTreeModel';
import ScopedOptimalityPanel from './shared/ScopedOptimalityPanel';

function nodeCaption(node: CostNode): string {
  if (node.kind === 'leaf') return node.slot.name;
  return node.label ?? `${node.kind} node`;
}

/** On-demand scoped optimality for the selected CostTree container. */
export default function ScopedOptimalityCard({
  result,
  tree,
  section,
  selectedScopeId,
  available,
  evidence,
}: {
  readonly result: ResultRef & { readonly kind: 'run' | 'prediction' };
  readonly tree: CostTree;
  readonly section: string;
  readonly selectedScopeId: number | null;
  readonly available: boolean;
  readonly evidence: {
    readonly evidenceId: string;
    readonly selectedForAgent: boolean;
    readonly onEvidenceSelect: () => void;
  };
}) {
  const selection = useMemo(() => {
    if (selectedScopeId === null) return null;
    const node = nodeById(tree, selectedScopeId);
    if (node === null) return null;
    const ordinals = nodeOrdinalPath(tree, selectedScopeId);
    if (ordinals === null) return null;
    const path = ordinals === '' ? section : `${section}/${ordinals}`;
    return { node, path };
  }, [section, selectedScopeId, tree]);

  return (
    <ScopedOptimalityPanel
      caption={selection === null ? null : `${nodeCaption(selection.node)} · ${selection.path}`}
      hint={`Select a CostTree container to compute its R0/R5/R6/R7 ladder over the whole ${result.kind}.`}
      resetKey={selection === null ? null : `${result.id}:${selection.path}`}
      artifact={
        available && selection !== null
          ? scopedOptimalityRef(result, { path: selection.path })
          : null
      }
      evidence={evidence}
    />
  );
}
