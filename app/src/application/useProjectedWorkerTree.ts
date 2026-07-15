import type { CostNode } from '../data/tree';
import { useViz } from '../store';
import { useActiveRun } from './ActiveRunProvider';
import { projectWorkerTree } from './runSelection';
import { useActiveWorkerTree } from './WorkerTreeProvider';

/** The only normal component entry point for a worker cost tree. The provider
 * owns transport/cache state; this hook owns the optional iteration projection. */
export function useProjectedWorkerTree(): CostNode {
  const run = useActiveRun();
  const state = useViz();
  const aggregateTree = useActiveWorkerTree();
  return projectWorkerTree(run, state, aggregateTree);
}
