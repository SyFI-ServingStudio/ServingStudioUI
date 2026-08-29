import { useMemo } from 'react';

import { useActiveRun } from '../../application/ActiveRunProvider';
import { useAnalyzerRepositoryIfAvailable } from '../../application/RepositoryProvider';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { nodeById, nodeOrdinalPath, type CostNode } from '../../domain/cost-tree';
import { ScopedOptimalityPanel } from '../optimality';
import { useViz } from '../../store';

function nodeCaption(node: CostNode): string {
  if (node.kind === 'leaf') return node.slot.name;
  return node.label ?? `${node.kind} node`;
}

/** Scoped optimality for the CostTree node selected in the run workbench,
 * addressed by ordinal path within the operation's manifest section. */
export default function ScopedOptimalityCard() {
  const treeState = useActiveWorkerTreeState();
  const scope = useViz((state) => state.scope);
  const leafId = useViz((state) => state.leafId);
  const parId = useViz((state) => state.parId);
  const run = useActiveRun();
  const repository = useAnalyzerRepositoryIfAvailable();

  const ready = treeState.status === 'ready';
  const selectedId = scope === 'kernel' ? leafId : scope === 'parallel' ? parId : null;
  const selection = useMemo(() => {
    if (!ready || selectedId === null) return null;
    const node = nodeById(treeState.tree, selectedId);
    if (node === null) return null;
    const ordinals = nodeOrdinalPath(treeState.tree, selectedId);
    if (ordinals === null) return null;
    const path = ordinals === '' ? treeState.section : `${treeState.section}/${ordinals}`;
    return { node, path };
  }, [ready, selectedId, treeState]);

  if (!ready || repository === null || repository.getScopedOptimality === undefined) return null;
  const getScopedOptimality = repository.getScopedOptimality.bind(repository);

  return (
    <ScopedOptimalityPanel
      caption={selection === null ? null : `${nodeCaption(selection.node)} · ${selection.path}`}
      hint="Select a CostTree node to compute its R0/R5/R6/R7 ladder over the whole run."
      resetKey={selection === null ? null : `${run.id}:${selection.path}`}
      compute={
        selection === null
          ? null
          : () => getScopedOptimality(run.id, { path: selection.path })
      }
    />
  );
}
