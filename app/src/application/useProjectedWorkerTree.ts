import type { CostTree } from '../data/tree';
import { useViz } from '../store';
import { useActiveRun } from './ActiveRunProvider';
import { projectWorkerTree } from './runSelection';
import { useActiveWorkerTree } from './WorkerTreeProvider';

/** The only normal component entry point for worker tree visualization. The
 * provider preserves detail-vs-aggregate evidence; this hook owns only the
 * optional synthetic iteration projection. */
export function useProjectedWorkerTree(): CostTree {
  const run = useActiveRun();
  const state = useViz();
  const baseTree = useActiveWorkerTree();
  return projectWorkerTree(run, state, baseTree);
}
